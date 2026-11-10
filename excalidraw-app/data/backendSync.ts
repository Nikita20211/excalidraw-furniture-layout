/**
 * Персистентность доски на бэкенде EventBooking, привязанная к чату
 * (chatId + token в query-строке рисовалки). Параллельно с этим модулем
 * продолжает работать LocalData (браузерный localStorage/IndexedDB) и
 * realtime-коллаборация — этот слой их не заменяет, а дополняет.
 */
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "../../packages/excalidraw/element/types";
import type { AppState, BinaryFiles } from "../../packages/excalidraw/types";
import { debounce } from "../../packages/excalidraw/utils";
import {
  GALLERY_FILE_ID_PREFIX,
  PLAN_IMAGE_FILE_ID,
  type GalleryImageEntry,
} from "./planImage";
import { EVENTBOOKING_BACKEND_URL as API_BASE_URL } from "./eventbookingConfig";

const AUTOSAVE_TIMEOUT = 1500;

export interface EventBookingParams {
  chatId: string;
  token: string;
}

export const getEventBookingParams = (): EventBookingParams | null => {
  const params = new URLSearchParams(window.location.search);
  const chatId = params.get("chatId");
  const token = params.get("token");
  if (!chatId || !token) {
    return null;
  }
  return { chatId, token };
};

export const setEventBookingParams = (params: EventBookingParams) => {
  const url = new URL(window.location.href);
  url.searchParams.set("chatId", params.chatId);
  url.searchParams.set("token", params.token);
  window.history.replaceState({}, "", url.toString());
};

const request = async <T = any>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> => {
  const url = new URL(`${API_BASE_URL}${path}`);
  // Токен — в заголовке Authorization, не в адресе запроса: адреса попадают в
  // журнал доступа основного сайта, а /drawing/* вызывается каждые 1,5 с.
  // Бэкенд читает Bearer первым (DrawingController::getRequestToken).
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url.toString(), { ...init, headers });
  if (!response.ok) {
    throw new Error(
      `EventBooking request failed: ${path} (${response.status})`,
    );
  }
  return response.json();
};

export interface SceneResponse {
  status: string;
  scene: string | null;
  updated_at: number | null;
  plan_image_url: string | null;
}

export const fetchScene = (token: string): Promise<SceneResponse> =>
  request<SceneResponse>("/drawing/get-scene", token);

/**
 * Ни план помещения, ни фото площадки из галереи не хранятся в scene_data —
 * сервер может отдать их заново в любой момент (getPlanImageUrl /
 * /drawing/gallery-images), клиент пересобирает эти файлы при каждой
 * загрузке (buildPlanImageElement / rehydrateGalleryFiles ниже). Пересылать
 * их обратно на save-scene/save-snapshot незачем — это лишние
 * сотни-килобайт-мегабайты base64 на КАЖДЫЙ автосейв, ничего не меняющие по
 * сути, и именно раздувание тела запроса было причиной периодических
 * сетевых сбоев (сервер отвечал 200 даже на "упавшие" запросы — проблема
 * была в размере тела запроса, а не в CORS как таковом; см. историю
 * отладки — заодно нашёлся и пофикшен реальный баг: nginx-прокси рисовалки
 * не задавал client_max_body_size, дефолт nginx 1MB рвал план помещения и
 * подавно несколько фото разом).
 *
 * Сами ELEMENTS (позиция/размер картинки на холсте) остаются в scene_data
 * как обычно — вырезаются только тяжёлые байты в `files`, чтобы при
 * следующей загрузке было ясно, что именно дотягивать (см.
 * rehydrateGalleryFiles).
 */
const isGalleryFileId = (fileId: string): boolean =>
  fileId.startsWith(GALLERY_FILE_ID_PREFIX);

const stripServerSourcedFiles = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): { elements: readonly ExcalidrawElement[]; files: BinaryFiles } => {
  const restFiles: BinaryFiles = {};
  for (const [fileId, file] of Object.entries(files)) {
    if (fileId !== PLAN_IMAGE_FILE_ID && !isGalleryFileId(fileId)) {
      restFiles[fileId as keyof BinaryFiles] = file;
    }
  }
  return {
    // План помещения фильтруем целиком, элемент включительно: он и так
    // безусловно пересобирается заново на каждой загрузке
    // (buildPlanImageElement, см. initializeScene/onApplyScene) — если не
    // выкинуть его отсюда, при следующей загрузке появится дубль (свежий +
    // из scene_data). Фото из галереи — наоборот, элемент (позиция/размер на
    // холсте) оставляем как есть, вырезаем только тяжёлые байты в `files` —
    // они не добавляются автоматически, только по клику пользователя, и не
    // должны пропадать при перезагрузке; недостающие байты дотягиваются
    // отдельно через rehydrateGalleryFiles.
    elements: elements.filter(
      (element) =>
        !(element.type === "image" && element.fileId === PLAN_IMAGE_FILE_ID),
    ),
    files: restFiles,
  };
};

const scenePayload = (
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
) => {
  const stripped = stripServerSourcedFiles(elements, files);
  return JSON.stringify({
    scene: { elements: stripped.elements, appState, files: stripped.files },
  });
};

const postScene = (
  token: string,
  elements: readonly ExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
) =>
  request("/drawing/save-scene", token, {
    method: "POST",
    body: scenePayload(elements, appState, files),
  });

type SaveArgs = [string, readonly ExcalidrawElement[], Partial<AppState>, BinaryFiles];

const RETRY_DELAYS_MS = [400, 1200];

// Не более одного save-scene запроса в моменте: если debounce успел
// сработать снова, пока предыдущий запрос ещё летит, новые данные не
// отправляются вторым параллельным запросом, а просто ждут своей очереди —
// после завершения текущего запроса тут же уходит следующий, уже с самыми
// свежими elements/appState/files.
//
// Плюс ретраи (внутри лока, не параллельно): первый автосейв сразу после
// переключения доски (onReissueToken → history.replaceState → updateScene)
// иногда falsely репортится браузером как "blocked by CORS" — сервер при
// этом отвечает 200 (проверено по логам php-fpm), т.е. это сбой на стороне
// клиента, а не бэкенда. Одиночный ретрай через короткую паузу забирает
// такие случаи надёжно.
let isSaving = false;
let pendingArgs: SaveArgs | null = null;

const postSceneWithRetry = async (args: SaveArgs) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await postScene(...args);
      return;
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
      );
    }
  }
};

const runSave = (...args: SaveArgs) => {
  if (isSaving) {
    pendingArgs = args;
    return;
  }
  isSaving = true;
  postSceneWithRetry(args)
    .catch((error) => {
      console.error("EventBooking autosave failed", error);
    })
    .finally(() => {
      isSaving = false;
      if (pendingArgs) {
        const next = pendingArgs;
        pendingArgs = null;
        runSave(...next);
      }
    });
};

/**
 * Класс-обёртка по образцу LocalData (data/LocalData.ts): debounce +
 * flush для сохранения при unload/blur/beforeunload.
 */
export class BackendSync {
  private static _save = debounce(runSave, AUTOSAVE_TIMEOUT);

  static save = (
    token: string,
    elements: readonly ExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    this._save(token, elements, appState, files);
  };

  static flushSave = () => {
    this._save.flush();
  };
}

export interface SaveSnapshotResponse {
  status: string;
  id: number;
  title: string;
  created_at: number;
}

export const saveSnapshot = (
  token: string,
  elements: readonly NonDeletedExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  title: string,
): Promise<SaveSnapshotResponse> => {
  const stripped = stripServerSourcedFiles(elements, files);
  return request<SaveSnapshotResponse>("/drawing/save-snapshot", token, {
    method: "POST",
    body: JSON.stringify({
      scene: { elements: stripped.elements, appState, files: stripped.files },
      title,
    }),
  });
};

export interface BoardEntry {
  chat_id: number;
  product_title: string | null;
  company_title: string | null;
  updated_at: number;
  is_current_chat: boolean;
}

export interface SnapshotEntry {
  id: number;
  chat_id: number;
  title: string;
  product_title: string | null;
  company_title: string | null;
  created_at: number;
  is_current_chat: boolean;
}

export interface ListBoardsResponse {
  status: string;
  current_chat_id: number;
  autosaves: BoardEntry[];
  snapshots: SnapshotEntry[];
}

export const listBoards = (token: string): Promise<ListBoardsResponse> =>
  request<ListBoardsResponse>("/drawing/list-boards", token);

export interface LoadSnapshotResponse {
  status: string;
  chat_id: number;
  title: string;
  scene: string;
  created_at: number;
  plan_image_url: string | null;
}

export const loadSnapshotById = (
  token: string,
  id: number,
): Promise<LoadSnapshotResponse> =>
  request<LoadSnapshotResponse>(`/drawing/load-snapshot?id=${id}`, token);

export interface ReissueTokenResponse {
  status: string;
  token: string;
  chat_id: number;
}

export const reissueToken = (
  token: string,
  chatId: number,
): Promise<ReissueTokenResponse> =>
  request<ReissueTokenResponse>(
    `/drawing/reissue-token?chat_id=${chatId}`,
    token,
  );

export interface InviteResponse {
  status: string;
  already_invited: boolean;
  chat_link: string;
  contacts: {
    phone: string | null;
    phone_digits: string | null;
    whatsapp: string | null;
    whatsapp_digits: string | null;
    telegram: string | null;
  };
}

export const inviteManager = (
  token: string,
  roomLink?: string | null,
): Promise<InviteResponse> =>
  request<InviteResponse>("/drawing/invite", token, {
    method: "POST",
    body: roomLink ? JSON.stringify({ room_link: roomLink }) : undefined,
  });

export interface GalleryImagesResponse {
  status: string;
  images: GalleryImageEntry[];
}

export const fetchGalleryImages = (
  token: string,
): Promise<GalleryImagesResponse> =>
  request<GalleryImagesResponse>("/drawing/gallery-images", token);

/**
 * Дотягивает файлы фото площадки, вырезанные при сохранении
 * (stripServerSourcedFiles), — вызывается при загрузке сцены (initializeScene,
 * переключение доски). Сканирует elements на fileId с GALLERY_FILE_ID_PREFIX,
 * которых ещё нет в already-loaded files, и запрашивает /drawing/gallery-images
 * ТОЛЬКО если такие вообще нашлись (не тратит лишний запрос на доски без
 * фото из галереи).
 */
export const rehydrateGalleryFiles = async (
  token: string,
  elements: readonly { type: string; fileId?: unknown }[],
  files: BinaryFiles,
): Promise<BinaryFiles> => {
  const missingIds = new Set<string>();
  for (const element of elements) {
    if (
      element.type === "image" &&
      typeof element.fileId === "string" &&
      isGalleryFileId(element.fileId) &&
      !files[element.fileId as keyof BinaryFiles]
    ) {
      missingIds.add(element.fileId);
    }
  }
  if (!missingIds.size) {
    return files;
  }

  let images: GalleryImageEntry[];
  try {
    images = (await fetchGalleryImages(token)).images;
  } catch (error: any) {
    console.error("rehydrateGalleryFiles failed", error);
    return files;
  }

  const rehydrated: BinaryFiles = { ...files };
  for (const image of images) {
    const fileId = GALLERY_FILE_ID_PREFIX + image.id;
    if (!missingIds.has(fileId)) {
      continue;
    }
    const mimeMatch = image.dataUrl.match(/^data:([^;]+);/);
    rehydrated[fileId as keyof BinaryFiles] = {
      mimeType: (mimeMatch?.[1] || "image/jpeg") as any,
      id: fileId as any,
      dataURL: image.dataUrl as any,
      created: Date.now(),
      lastRetrieved: Date.now(),
    };
  }
  return rehydrated;
};
