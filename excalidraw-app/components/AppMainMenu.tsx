import React from "react";
import { eyeIcon } from "../../packages/excalidraw/components/icons";
import type { Theme } from "../../packages/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "../../packages/excalidraw/types";
import { MainMenu } from "../../packages/excalidraw/index";
import { LanguageList } from "../app-language/LanguageList";
import { saveDebugState } from "./DebugCanvas";
import { t } from "../../packages/excalidraw/i18n";
import type { EventBookingParams } from "../data/backendSync";
import { MenuSaveItem } from "./eventbooking/MenuSaveItem";
import { MenuOpenItem } from "./eventbooking/MenuOpenItem";
import { MenuInviteItem } from "./eventbooking/MenuInviteItem";
import { MenuGalleryItem } from "./eventbooking/MenuGalleryItem";

export const AppMainMenu: React.FC<{
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  theme: Theme | "system";
  setTheme: (theme: Theme | "system") => void;
  refresh: () => void;
  eventBookingParams: EventBookingParams | null;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onReissueToken: (chatId: number) => Promise<EventBookingParams | null>;
  onApplyScene: (
    scene: { elements?: unknown; appState?: unknown; files?: unknown } | null,
    planImageUrl: string | null,
  ) => Promise<void>;
}> = React.memo((props) => {
  const { eventBookingParams } = props;
  // chatId="0" — "аккаунтный" токен без привязки к конкретному чату (см.
  // DrawingController::actionUserTokenRedirect, выдаётся при "стандартном"
  // открытии рисовалки без ссылки из чата). "Открыть" и "Сохранить" уже
  // работают под chat_id=0 (см. sceneOwnerCondition в DrawingController —
  // личная доска, своя у каждого пользователя, не общая) — только
  // "Пригласить"/"Загрузить фото" остаются недоступны: им нужен реальный
  // товар/чат, которого у личной доски нет.
  const isAccountLevel = eventBookingParams?.chatId === "0";

  return (
    <MainMenu>
      {eventBookingParams ? (
        <>
          <MenuSaveItem
            token={eventBookingParams.token}
            excalidrawAPI={props.excalidrawAPI}
          />
          <MenuOpenItem
            eventBookingParams={eventBookingParams}
            onReissueToken={props.onReissueToken}
            onApplyScene={props.onApplyScene}
          />
          {!isAccountLevel && (
            <>
              <MenuInviteItem token={eventBookingParams.token} />
              <MenuGalleryItem
                token={eventBookingParams.token}
                excalidrawAPI={props.excalidrawAPI}
              />
            </>
          )}
        </>
      ) : (
        <>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
        </>
      )}
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      {props.isCollabEnabled && (
        <MainMenu.DefaultItems.LiveCollaborationTrigger
          isCollaborating={props.isCollaborating}
          onSelect={() => props.onCollabDialogOpen()}
        />
      )}
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.DefaultItems.LicenceAgreement />
      {import.meta.env.DEV && (
        <MainMenu.Item
          icon={eyeIcon}
          onClick={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          {t("visualDebug.visualDebug")}
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ToggleTheme
        allowSystemTheme
        theme={props.theme}
        onSelect={props.setTheme}
      />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
});
