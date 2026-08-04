import { Card } from "../../../packages/excalidraw/components/Card";
import { ToolButton } from "../../../packages/excalidraw/components/ToolButton";
import { save } from "../../../packages/excalidraw/components/icons";
import type { NonDeletedExcalidrawElement } from "../../../packages/excalidraw/element/types";
import type { AppState, BinaryFiles } from "../../../packages/excalidraw/types";
import { saveSnapshot } from "../../data/backendSync";

/**
 * Замена карточки "Excalidraw+" в диалоге "Сохранить как..." (стоковый пункт
 * меню MainMenu.DefaultItems.Export) — та карточка вела на реальный
 * Excalidraw+ через Firebase Storage, которого у нас больше нет. Делает то
 * же самое, что и MenuSaveItem (бургер-меню "Сохранить на сервер"): пишет
 * новый ручной снимок через actionSaveSnapshot, без диалога названия — тут
 * это просто ещё одна кнопка сохранения, title получает дефолт на бэкенде
 * ("Снимок от {дата}").
 */
export const SaveToServerExportCard = ({
  token,
  elements,
  appState,
  files,
  onError,
  onSuccess,
}: {
  token: string;
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  onError: (error: Error) => void;
  onSuccess: () => void;
}) => {
  return (
    <Card color="primary">
      <div className="Card-icon">{save}</div>
      <h2>Сохранить на сервере Eventbooking</h2>
      <div className="Card-details">
        Сохранит текущую версию доски отдельным снимком на сервере
        Eventbooking — он будет доступен вам и менеджеру площадки в любое
        время через пункт меню «Открыть».
      </div>
      <ToolButton
        className="Card-button"
        type="button"
        title="Сохранить на сервере"
        aria-label="Сохранить на сервере"
        showAriaLabel={true}
        onClick={async () => {
          try {
            await saveSnapshot(token, elements, appState, files, "");
            onSuccess();
          } catch (error) {
            console.error("Save to server failed", error);
            onError(new Error("Не удалось сохранить на сервере"));
          }
        }}
      />
    </Card>
  );
};
