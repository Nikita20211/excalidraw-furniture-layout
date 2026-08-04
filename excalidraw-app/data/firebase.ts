import type {
  ExcalidrawElement,
  FileId,
} from "../../packages/excalidraw/element/types";
import type Portal from "../collab/Portal";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "../../packages/excalidraw/types";
import { decompressData } from "../../packages/excalidraw/data/encode";
import { MIME_TYPES } from "../../packages/excalidraw/constants";
import type { SyncableExcalidrawElement } from ".";
import type { Socket } from "socket.io-client";
import {
  encryptData,
  decryptData,
} from "../../packages/excalidraw/data/encryption";

/**
 * Firebase вырезан: наш excalidraw-room (excalidraw-room-proxy,
 * ws-excalidraw.new.local) — чистый stateless-релей элементов сцены, ему не
 * нужен внешний бэкенд для их хранения — своя персистентность есть отдельно
 * для чатовых досок (chat_drawing_scene/chat_drawing_snapshot), но КОМНАТЫ
 * Live-коллаборации (кнопка "Поделиться"/"Пригласить менеджера площадки")
 * создаются самим Excalidraw на клиенте и никак не связаны с chat_id —
 * ссылка на комнату (#room=...) сама по себе не несёт chatId/token, поэтому
 * гость, открывший её без активного собеседника в сокете, не может
 * получить сцену через наш обычный бэкенд. Заменяет сценарий Firebase
 * Storage/Firestore: DrawingController::actionSaveRoomScene/
 * actionLoadRoomScene, таблица chat_drawing_room_scene, ключ room_id —
 * контент шифруется здесь же тем же ключом комнаты (roomKey), что и
 * элементы, летящие по сокету (см. Portal.ts::_broadcastSocketData) —
 * сервер хранит непрозрачный blob.
 *
 * ФАЙЛЫ (картинки) — отдельная история, уже решённая раньше: их бинарные
 * данные НЕ идут через сокет вместе с элементами, а раньше подтягивались из
 * Firebase Storage отдельным HTTP-запросом. Заменены на свой файловый
 * relay: DrawingController::actionSaveRoomFiles/actionLoadRoomFiles, таблица
 * chat_drawing_room_file, ключ (room_id, file_id) — тот же принцип, что был
 * у публичного бакета Firebase Storage.
 */

const API_BASE_URL = "https://eventbooking.new.local";

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * prefix раньше был путём в Firebase Storage вида "/files/rooms/<roomId>"
 * (см. FIREBASE_STORAGE_PREFIXES.collabFiles в app_constants.ts) — нам из
 * него нужен только сам roomId, последний сегмент пути.
 */
const extractRoomId = (prefix: string): string => {
  const segments = prefix.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
};

export const isSavedToFirebase = (
  _portal: Portal,
  _elements: readonly ExcalidrawElement[],
): boolean => {
  // Всегда true — чтобы beforeUnload не блокировал закрытие вкладки в
  // ожидании сохранения сцены, которого больше не происходит (см. коммент
  // к модулю — реконсиляция элементов и так идёт через сокет).
  return true;
};

export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  _appState: AppState,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  const { roomId, roomKey } = portal;
  if (!roomId || !roomKey) {
    return null;
  }

  try {
    const json = JSON.stringify(elements);
    const { encryptedBuffer, iv } = await encryptData(
      roomKey,
      new TextEncoder().encode(json),
    );

    const response = await fetch(`${API_BASE_URL}/drawing/save-room-scene`, {
      method: "POST",
      body: JSON.stringify({
        room_id: roomId,
        iv: uint8ArrayToBase64(iv),
        data: uint8ArrayToBase64(new Uint8Array(encryptedBuffer)),
      }),
    });
    if (!response.ok) {
      return null;
    }
    return elements;
  } catch (error: any) {
    console.error("saveToFirebase (room-scene backend) failed", error);
    return null;
  }
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  _socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  try {
    const url = new URL(`${API_BASE_URL}/drawing/load-room-scene`);
    url.searchParams.set("room_id", roomId);
    const response = await fetch(url.toString());
    if (!response.ok) {
      return null;
    }
    const result = await response.json();
    if (!result.data || !result.iv) {
      return null;
    }

    const decrypted = await decryptData(
      base64ToUint8Array(result.iv),
      base64ToUint8Array(result.data),
      roomKey,
    );
    const json = new TextDecoder().decode(decrypted);
    return JSON.parse(json) as SyncableExcalidrawElement[];
  } catch (error: any) {
    console.error("loadFromFirebase (room-scene backend) failed", error);
    return null;
  }
};

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}): Promise<{ savedFiles: FileId[]; erroredFiles: FileId[] }> => {
  const roomId = extractRoomId(prefix);
  if (!roomId || !files.length) {
    return { savedFiles: [], erroredFiles: files.map(({ id }) => id) };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/drawing/save-room-files`, {
      method: "POST",
      body: JSON.stringify({
        room_id: roomId,
        files: files.map(({ id, buffer }) => ({
          id,
          data: uint8ArrayToBase64(buffer),
        })),
      }),
    });
    if (!response.ok) {
      return { savedFiles: [], erroredFiles: files.map(({ id }) => id) };
    }
    const result = await response.json();
    return {
      savedFiles: result.saved ?? [],
      erroredFiles: result.errored ?? [],
    };
  } catch (error: any) {
    console.error("saveFilesToFirebase (room-file backend) failed", error);
    return { savedFiles: [], erroredFiles: files.map(({ id }) => id) };
  }
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
): Promise<{
  loadedFiles: BinaryFileData[];
  erroredFiles: Map<FileId, true>;
}> => {
  const roomId = extractRoomId(prefix);
  const uniqueIds = [...new Set(filesIds)];
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  if (!roomId || !uniqueIds.length) {
    return { loadedFiles, erroredFiles };
  }

  try {
    const url = new URL(`${API_BASE_URL}/drawing/load-room-files`);
    url.searchParams.set("room_id", roomId);
    uniqueIds.forEach((id) => url.searchParams.append("file_ids[]", id));

    const response = await fetch(url.toString());
    if (!response.ok) {
      uniqueIds.forEach((id) => erroredFiles.set(id, true));
      return { loadedFiles, erroredFiles };
    }
    const result = await response.json();
    const files: Record<string, string> = result.files ?? {};

    await Promise.all(
      uniqueIds.map(async (id) => {
        const base64 = files[id];
        if (!base64) {
          erroredFiles.set(id, true);
          return;
        }
        try {
          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            base64ToUint8Array(base64),
            { decryptionKey },
          );
          const dataURL = new TextDecoder().decode(data) as DataURL;
          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } catch (error: any) {
          erroredFiles.set(id, true);
          console.error(error);
        }
      }),
    );
  } catch (error: any) {
    uniqueIds.forEach((id) => erroredFiles.set(id, true));
    console.error(error);
  }

  return { loadedFiles, erroredFiles };
};

/**
 * Используется только "Export to Excalidraw+" (несвязанная с нашей
 * рисовалкой фича — выгрузка сцены в облачный аккаунт excalidraw.com,
 * который мы не используем). Кидает управляемую ошибку вместо тихого
 * прохода — вызывающий код (ExportToExcalidrawPlus.tsx) уже ловит её через
 * свой onError.
 */
export const loadFirebaseStorage = async (): Promise<any> => {
  throw new Error(
    "Firebase отключён в этой сборке — экспорт в Excalidraw+ недоступен.",
  );
};
