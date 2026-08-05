import polyfill from "../packages/excalidraw/polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "../packages/excalidraw/analytics";
import { getDefaultAppState } from "../packages/excalidraw/appState";
import { ErrorDialog } from "../packages/excalidraw/components/ErrorDialog";
import { TopErrorBoundary } from "./components/TopErrorBoundary";
import {
  APP_NAME,
  EVENT,
  THEME,
  TITLE_TIMEOUT,
  VERSION_TIMEOUT,
} from "../packages/excalidraw/constants";
import { loadFromBlob } from "../packages/excalidraw/data/blob";
import eventBookingDefaultLibrary from "./data/eventbooking-default-library.excalidrawlib.json";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "../packages/excalidraw/element/types";
import { useCallbackRefState } from "../packages/excalidraw/hooks/useCallbackRefState";
import { t } from "../packages/excalidraw/i18n";
import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  StoreAction,
  reconcileElements,
} from "../packages/excalidraw";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
} from "../packages/excalidraw/types";
import type { ResolvablePromise } from "../packages/excalidraw/utils";
import {
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
} from "../packages/excalidraw/utils";
import {
  FIREBASE_STORAGE_PREFIXES,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import type { CollabAPI } from "./collab/Collab";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import {
  getCollaborationLinkData,
  isCollaborationLink,
  loadScene,
} from "./data";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";
import CustomStats from "./CustomStats";
import type { RestoredDataState } from "../packages/excalidraw/data/restore";
import { restore, restoreAppState } from "../packages/excalidraw/data/restore";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { SaveToServerExportCard } from "./components/eventbooking/SaveToServerExportCard";
import { updateStaleImageStatuses } from "./data/FileManager";
import { newElementWith } from "../packages/excalidraw/element/mutateElement";
import { isInitializedImageElement } from "../packages/excalidraw/element/typeChecks";
import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import {
  BackendSync,
  fetchScene,
  getEventBookingParams,
  setEventBookingParams,
  reissueToken,
  rehydrateGalleryFiles,
  type EventBookingParams,
} from "./data/backendSync";
import { buildPlanImageElement } from "./data/planImage";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "../packages/excalidraw/data/library";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { InviteManagerTopButton } from "./components/eventbooking/InviteManagerTopButton";
import { WelcomeNotice } from "./components/eventbooking/WelcomeNotice";
import { AppFooter } from "./components/AppFooter";
import { Provider, useAtom, useAtomValue } from "jotai";
import { useAtomWithInitialValue } from "../packages/excalidraw/jotai";
import { appJotaiStore } from "./app-jotai";

import "./index.scss";
import type { ResolutionType } from "../packages/excalidraw/utility-types";
import { openConfirmModal } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { OverwriteConfirmDialog } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import Trans from "../packages/excalidraw/components/Trans";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import type { RemoteExcalidrawElement } from "../packages/excalidraw/data/reconcile";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "../packages/excalidraw/components/CommandPalette/CommandPalette";
import {
  usersIcon,
  exportToPlus,
  share,
} from "../packages/excalidraw/components/icons";
import { appThemeAtom, useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";
import { isElementLink } from "../packages/excalidraw/element/elementLink";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const eventBookingParams = getEventBookingParams();
  if (eventBookingParams) {
    // chatId="0" — личная доска аккаунтного уровня (см. AppMainMenu.tsx):
    // "стандартное" открытие https://excalidraw.new.local всегда должно
    // давать чистый лист, а не автовосстанавливать то, что было на нём в
    // прошлый раз — автосейва для этого режима нет (см. onChange ниже),
    // поэтому и подгружать здесь нечего. Явные "Сохранить"/"Открыть"
    // (ручные снимки chat_drawing_snapshot) по-прежнему работают — просто
    // не автоподгружаются при обычном заходе.
    if (eventBookingParams.chatId === "0") {
      return {
        scene: { elements: [], appState: {}, files: {} },
        isExternalScene: false,
      };
    }

    // Доска чата EventBooking — отдельная ветка вместо localStorage/collab:
    // сцена приходит с бэкенда по chatId/token, реалтайм-коллаборация (если
    // включена конфигом комнаты) продолжает работать поверх неё как обычно.
    const response = await fetchScene(eventBookingParams.token);
    const parsedScene = response.scene ? JSON.parse(response.scene) : null;
    let files = { ...(parsedScene?.files || {}) };

    let planImageElement = null;
    if (response.plan_image_url) {
      const planImage = await buildPlanImageElement(response.plan_image_url);
      planImageElement = planImage.element;
      files = { ...files, ...planImage.files };
    }

    const baseElements = (parsedScene?.elements || []) as any[];

    // Фото площадки из галереи хранятся в scene_data только как элементы
    // (позиция/размер) — сами байты вырезаются при сохранении
    // (stripServerSourcedFiles) и дотягиваются здесь заново, если на них
    // вообще есть ссылки в загруженной сцене.
    files = await rehydrateGalleryFiles(
      eventBookingParams.token,
      baseElements,
      files,
    );

    return {
      scene: {
        elements: planImageElement
          ? [planImageElement, ...baseElements]
          : baseElements,
        appState: parsedScene?.appState || {},
        files: files as any,
      },
      isExternalScene: false,
    };
  }

  // "Стандартное" открытие рисовалки — https://excalidraw.new.local без
  // chatId/token и без каких-либо других признаков внешней сцены (room,
  // json, url, id). У рисовалки нет сессии (отдельный поддомен без общих
  // cookie с eventbooking.new.local), поэтому вместо no-op редиректим на
  // сессионный экшен, который сам выпишет "аккаунтный" токен (chat_id=0,
  // выше уровня одного чата — actionListBoards() и так использует из него
  // только user_id) и вернёт обратно уже с ?chatId=0&token=... — после
  // этого редиректа рисовалка попадает в обычную ветку eventBookingParams
  // выше, просто с пустой доской и работающим пунктом меню "Открыть" на
  // все сохранённые доски пользователя.
  const hasAnyExternalIndicator =
    !!new URLSearchParams(window.location.search).get("id") ||
    /^#(json|room|url)=/.test(window.location.hash);
  if (!hasAnyExternalIndicator) {
    window.location.href =
      "https://eventbooking.new.local/drawing/user-token-redirect";
    // ничего больше не инициализируем, пока браузер не уйдёт по редиректу
    return new Promise<never>(() => {});
  }

  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: RestoredDataState & {
    scrollToContent?: boolean;
  } = await loadScene(null, null, localDataState);

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        scene = await loadScene(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
          localDataState,
        );
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const [appTheme, setAppTheme] = useAtom(appThemeAtom);
  const { editorTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [excalidrawAPI, excalidrawRefCallback] =
    useCallbackRefState<ExcalidrawImperativeAPI>();

  // Доска, привязанная к чату EventBooking (chatId+token в URL) — читается
  // один раз при загрузке страницы (initializeScene) и обновляется целиком
  // при переключении на другую доску из списка "Открыть" (см. switchBoard
  // ниже). Ref нужен, чтобы onChange (замыкание, созданное один раз) видел
  // актуальный token без пересоздания самого onChange.
  const [eventBookingParams, setEventBookingParamsState] =
    useState<EventBookingParams | null>(() => getEventBookingParams());
  const eventBookingParamsRef = useRef(eventBookingParams);
  useEffect(() => {
    eventBookingParamsRef.current = eventBookingParams;
  }, [eventBookingParams]);

  /**
   * Переключает текущую вкладку рисовалки на доску другого чата — первый
   * шаг выбора элемента в "Открыть" (BoardPickerDialog): переиздаёт токен
   * на целевой chat_id и обновляет URL, ПОСЛЕ ЧЕГО дальнейший автосейв идёт
   * уже в новый чат. Саму сцену (get-scene для автосохранения или
   * load-snapshot для ручного) запрашивает и применяет вызывающий код
   * (BoardPickerDialog) через onApplyScene — этот метод только "переключает
   * личность" вкладки.
   */
  const onReissueToken = useCallback(
    async (targetChatId: number): Promise<EventBookingParams | null> => {
      if (!eventBookingParamsRef.current) {
        return null;
      }
      const reissued = await reissueToken(
        eventBookingParamsRef.current.token,
        targetChatId,
      );
      const nextParams: EventBookingParams = {
        chatId: String(reissued.chat_id),
        token: reissued.token,
      };
      setEventBookingParams(nextParams);
      setEventBookingParamsState(nextParams);
      return nextParams;
    },
    [],
  );

  /**
   * Применяет полученную сцену (после onReissueToken) к текущему канвасу —
   * общий код для автосохранений и ручных снимков, включая фон плана
   * помещения (если он есть у целевого чата).
   */
  const onApplyScene = useCallback(
    async (
      scenePayload: {
        elements?: unknown;
        appState?: unknown;
        files?: unknown;
      } | null,
      planImageUrl: string | null,
    ) => {
      if (!excalidrawAPI) {
        return;
      }

      let files: BinaryFiles = { ...((scenePayload?.files || {}) as BinaryFiles) };
      let planImageElement = null;
      if (planImageUrl) {
        const planImage = await buildPlanImageElement(planImageUrl);
        planImageElement = planImage.element;
        files = { ...files, ...planImage.files };
      }

      if (Object.keys(files).length) {
        excalidrawAPI.addFiles(files);
      }

      const existingElements = (scenePayload?.elements ||
        []) as OrderedExcalidrawElement[];

      excalidrawAPI.updateScene({
        elements: planImageElement
          ? [planImageElement as any, ...existingElements]
          : existingElements,
        appState: (scenePayload?.appState || {}) as any,
        storeAction: StoreAction.CAPTURE,
      });
      excalidrawAPI.scrollToContent();
    },
    [excalidrawAPI],
  );

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    const loadImages = (
      data: ResolutionType<typeof initializeScene>,
      isInitialLoad = false,
    ) => {
      if (!data.scene) {
        return;
      }
      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
          });
        } else if (isInitialLoad && !eventBookingParamsRef.current) {
          // LocalData.fileStorage — общий на весь ОРИГИН (IndexedDB, не
          // привязан к конкретной доске/вкладке) кэш файлов для стокового
          // локального режима Excalidraw (один документ на весь браузер).
          // У наших досок свой собственный набор файлов уже полностью
          // приходит с бэкенда (buildPlanImageElement/rehydrateGalleryFiles
          // в initializeScene) — трогать этот общий кэш нельзя вовсе: у
          // всех досок один и тот же PLAN_IMAGE_FILE_ID (константа, не
          // per-chat), так что getFiles() тут же подменял план помещения
          // чужим кэшированным файлом из другой вкладки/доски, а
          // clearObsoleteFiles ещё и удалял из этого общего кэша файлы
          // ДРУГИХ досок, которых нет в текущей — именно поэтому несколько
          // одновременно открытых вкладок с разными досками "сливались" в
          // одну после перезагрузки.
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({ currentFileIds: fileIds });
        }
      }
    };

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      // Стандартный набор мебели/декора EventBooking — грузится вместе со
      // сценой в личную библиотеку каждого пользователя (merge: true в
      // App.tsx библиотеки, см. packages/excalidraw/components/App.tsx),
      // без похода на внешний libraries.excalidraw.com. Дедуп по составу
      // элементов (isUniqueItem), так что повторные загрузки страницы не
      // плодят дубли.
      initialStatePromiseRef.current.promise.resolve({
        ...(data.scene || {}),
        libraryItems: eventBookingDefaultLibrary.libraryItems as any,
      });
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              ...data.scene,
              ...restore(data.scene, null, null, { repairBindings: true }),
              storeAction: StoreAction.CAPTURE,
            });
          }
        });
      }
    };

    const titleTimeout = setTimeout(
      () => (document.title = APP_NAME),
      TITLE_TIMEOUT,
    );

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      // Стоковая "синхронизация между вкладками браузера" — на фокус/смену
      // видимости подтягивает elements/files из ОБЩЕГО localStorage/
      // IndexedDB происхождения, предполагая (как и LocalData.fileStorage,
      // см. loadImages выше), что все вкладки — это ОДИН общий документ.
      // У нас же каждая вкладка — независимая доска своего чата: при
      // переключении между вкладками эта синхронизация тут же затирала
      // текущую доску содержимым другой открытой вкладки. Полностью
      // отключаем её для EventBooking-досок — свою синхронизацию (в
      // рамках ОДНОЙ доски, между собой и совместно редактирующими) мы
      // ведём отдельно через BackendSync/collab.
      if (eventBookingParamsRef.current) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            storeAction: StoreAction.UPDATE,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
      BackendSync.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
        BackendSync.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
      clearTimeout(titleTimeout);
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();
      BackendSync.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        preventUnload(event);
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // chatId="0" — аккаунтный токен без привязки к чату (см. AppMainMenu.tsx):
    // "стандартное" открытие всегда должно давать чистый лист, поэтому
    // автосейва тут нет вовсе — только явное "Сохранить" (ручной снимок,
    // saveSnapshot), не привязанное к automatic restore при следующем заходе.
    if (
      eventBookingParamsRef.current &&
      eventBookingParamsRef.current.chatId !== "0"
    ) {
      BackendSync.save(
        eventBookingParamsRef.current.token,
        elements,
        appState,
        files,
      );
    }

    // Наши доски не используют стоковое локальное хранилище Excalidraw
    // вовсе (свой backend), а главное — LocalData.fileStorage (IndexedDB) в
    // нём общий на весь ОРИГИН, а не per-board: писать туда файлы каждой
    // доски (включая PLAN_IMAGE_FILE_ID — одну и ту же константу для ВСЕХ
    // досок) means нескольким одновременно открытым вкладкам с разными
    // досками было чем затирать общий кэш друг друга.
    //
    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!eventBookingParamsRef.current && !LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              storeAction: StoreAction.UPDATE,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        window.devicePixelRatio,
        () => forceRefresh((prev) => !prev),
      );
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        excalidrawAPI={excalidrawRefCallback}
        onChange={onChange}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    const onError = (error: Error) => {
                      excalidrawAPI?.updateScene({
                        appState: {
                          errorMessage: error.message,
                        },
                      });
                    };
                    const onSuccess = () => {
                      excalidrawAPI.updateScene({
                        appState: { openDialog: null },
                      });
                    };

                    // Карточка "Excalidraw+" вела на настоящий Excalidraw+
                    // через Firebase Storage, которого у нас больше нет —
                    // в EventBooking-контексте (всегда есть chatId/token)
                    // заменяем её на сохранение снимка на нашем сервере
                    // (то же самое, что бургер-меню "Сохранить на сервер") —
                    // работает и при chatId="0" (личная доска, см.
                    // sceneOwnerCondition в DrawingController).
                    if (eventBookingParams) {
                      return (
                        <SaveToServerExportCard
                          token={eventBookingParams.token}
                          elements={elements}
                          appState={appState}
                          files={files}
                          onError={onError}
                          onSuccess={onSuccess}
                        />
                      );
                    }

                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={onError}
                        onSuccess={onSuccess}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || isCollabDisabled) {
            return null;
          }
          return (
            <div className="top-right-ui">
              {collabError.message && <CollabError collabError={collabError} />}
              {eventBookingParams && eventBookingParams.chatId !== "0" && (
                <InviteManagerTopButton
                  token={eventBookingParams.token}
                  collabAPI={collabAPI}
                />
              )}
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.scrollToContent(element.link, { animate: true });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
          theme={appTheme}
          setTheme={(theme) => setAppTheme(theme)}
          refresh={() => forceRefresh((prev) => !prev)}
          eventBookingParams={eventBookingParams}
          excalidrawAPI={excalidrawAPI}
          onReissueToken={onReissueToken}
          onApplyScene={onApplyScene}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="collab-offline-warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog collabAPI={collabAPI} />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              ...CommandPalette.defaultItems.toggleTheme,
              perform: () => {
                setAppTheme(
                  editorTheme === THEME.DARK ? THEME.LIGHT : THEME.DARK,
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
      {eventBookingParams && (
        <WelcomeNotice
          token={eventBookingParams.token}
          excalidrawAPI={excalidrawAPI}
          isAccountLevel={eventBookingParams.chatId === "0"}
        />
      )}
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider unstable_createStore={() => appJotaiStore}>
        <ExcalidrawWrapper />
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
