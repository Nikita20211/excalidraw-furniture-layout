/**
 * Вставка изображения (data-URL) как image-элемента на канвас — используется
 * и для фонового "плана помещения" (залоченный, фиксированный fileId, один
 * на сцену), и для вставки фото площадки из галереи (обычный, разлоченный
 * элемент со своим случайным fileId — их может быть несколько одновременно).
 */
import { newImageElement } from "../../packages/excalidraw/element/newElement";
import { randomId } from "../../packages/excalidraw/random";
import { StoreAction } from "../../packages/excalidraw";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "../../packages/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
} from "../../packages/excalidraw/element/types";

export const PLAN_IMAGE_FILE_ID = "eventbooking-plan-image" as FileId;

/**
 * Общий префикс fileId для фото из галереи площадки — детерминированный
 * (на основе File::$id с бэкенда, не randomId()), чтобы:
 * 1) не пересылать эти файлы обратно на save-scene/save-snapshot (см.
 *    stripServerSourcedFiles в backendSync.ts) — сервер и так может отдать их
 *    заново по /drawing/gallery-images;
 * 2) при загрузке сцены опознавать, каких файлов не хватает, и дотягивать их
 *    (см. rehydrateGalleryFiles в backendSync.ts).
 */
export const GALLERY_FILE_ID_PREFIX = "eventbooking-gallery-";

export const galleryFileId = (imageId: string): FileId =>
  (GALLERY_FILE_ID_PREFIX + imageId) as FileId;

const measureImage = (
  dataUrl: string,
): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });

export const buildImageElement = async (
  dataUrl: string,
  opts: {
    fileId?: FileId;
    locked?: boolean;
    x?: number;
    y?: number;
  } = {},
): Promise<{ element: ExcalidrawImageElement; files: BinaryFiles }> => {
  const { width, height } = await measureImage(dataUrl);
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  const mimeType = (mimeMatch?.[1] ||
    "image/jpeg") as BinaryFileData["mimeType"];
  const fileId = opts.fileId ?? (randomId() as FileId);

  const element = newImageElement({
    type: "image",
    fileId,
    status: "saved",
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width,
    height,
    locked: opts.locked ?? false,
  });

  const files: BinaryFiles = {
    [fileId]: {
      mimeType,
      id: fileId,
      dataURL: dataUrl as BinaryFileData["dataURL"],
      created: Date.now(),
      lastRetrieved: Date.now(),
    },
  };

  return { element, files };
};

/** Фон "плана помещения" — фиксированный id, у сцены он один. */
export const buildPlanImageElement = (dataUrl: string) =>
  buildImageElement(dataUrl, {
    fileId: PLAN_IMAGE_FILE_ID,
    locked: true,
    x: 0,
    y: 0,
  });

const GALLERY_ROW_HEIGHT = 220;
const GALLERY_ROW_GAP = 24;

/** Y-координата ряда фото площадки — сразу под планом помещения, если он
 * есть на сцене, иначе с самого верха. */
const findGalleryRowY = (elements: readonly ExcalidrawElement[]): number => {
  const planImage = elements.find(
    (el): el is ExcalidrawImageElement =>
      el.type === "image" && el.fileId === PLAN_IMAGE_FILE_ID,
  );
  return planImage ? planImage.y + planImage.height + 40 : 0;
};

/** X-координата для следующей фотографии — правее уже вставленных в этом же
 * ряду, чтобы повторные вставки не наслаивались друг на друга (как было
 * раньше при фиксированных x:100,y:100). */
const findNextGalleryX = (
  elements: readonly ExcalidrawElement[],
  rowY: number,
): number => {
  const rowPhotos = elements.filter(
    (el): el is ExcalidrawImageElement =>
      el.type === "image" &&
      el.fileId !== PLAN_IMAGE_FILE_ID &&
      Math.abs(el.y - rowY) < 1,
  );
  if (!rowPhotos.length) {
    return 0;
  }
  return Math.max(...rowPhotos.map((el) => el.x + el.width)) + GALLERY_ROW_GAP;
};

export interface GalleryImageEntry {
  id: string;
  dataUrl: string;
}

/**
 * Вставляет одно фото площадки в ряд под планом помещения, правее уже
 * вставленных — используется и кнопкой в приветственном уведомлении
 * (вставляет все разом), и кликом по фото в галерее бургер-меню (по одному).
 * fileId детерминированный (galleryFileId(image.id)), не случайный — см.
 * комментарий у GALLERY_FILE_ID_PREFIX.
 */
export const insertGalleryImage = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  image: GalleryImageEntry,
): Promise<void> => {
  const existingElements = excalidrawAPI.getSceneElementsIncludingDeleted();
  const rowY = findGalleryRowY(existingElements);
  const x = findNextGalleryX(existingElements, rowY);

  const { element, files } = await buildImageElement(image.dataUrl, {
    x,
    y: rowY,
    fileId: galleryFileId(image.id),
  });
  const scale = GALLERY_ROW_HEIGHT / element.height;
  const scaledElement: ExcalidrawImageElement = {
    ...element,
    width: element.width * scale,
    height: GALLERY_ROW_HEIGHT,
  };

  excalidrawAPI.addFiles(files);
  excalidrawAPI.updateScene({
    elements: [...existingElements, scaledElement],
    storeAction: StoreAction.CAPTURE,
  });
};

/**
 * Вставляет сразу все фото площадки в ряд под планом помещения — кнопка
 * "Загрузить фотографии площадки" в приветственном уведомлении
 * (WelcomeNotice.tsx). Строго последовательно: x каждой следующей
 * фотографии зависит от размеров уже вставленных.
 */
export const insertGalleryImagesRow = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  images: GalleryImageEntry[],
): Promise<void> => {
  for (const image of images) {
    // eslint-disable-next-line no-await-in-loop
    await insertGalleryImage(excalidrawAPI, image);
  }
  excalidrawAPI.scrollToContent();
};
