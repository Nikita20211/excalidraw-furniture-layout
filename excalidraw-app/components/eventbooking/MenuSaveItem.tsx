import { useState } from "react";
import { MainMenu } from "../../../packages/excalidraw/index";
import { save } from "../../../packages/excalidraw/components/icons";
import type { ExcalidrawImperativeAPI } from "../../../packages/excalidraw/types";
import { saveSnapshot } from "../../data/backendSync";
import { SaveDialog } from "./SaveDialog";

/**
 * Заменяет стоковую "Сохранить" (локальный файл) — пишет ручное сохранение
 * на сервер EventBooking (actionSaveSnapshot), отдельной записью каждый раз.
 */
export const MenuSaveItem = ({
  token,
  excalidrawAPI,
}: {
  token: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  return (
    <>
      <MainMenu.Item
        icon={save}
        onSelect={(event) => {
          // Клик по MainMenu.Item по умолчанию закрывает (и размонтирует)
          // весь DropdownMenu.Content — вместе с ним и наш диалог, и его
          // isOpen-состояние. preventDefault() отменяет это автозакрытие,
          // чтобы диалог успел открыться; закрываем сами через onCancel.
          event.preventDefault();
          setIsOpen(true);
        }}
      >
        Сохранить на сервер
      </MainMenu.Item>
      {isOpen && (
        <SaveDialog
          isSaving={isSaving}
          onCancel={() => setIsOpen(false)}
          onConfirm={async (title) => {
            if (!excalidrawAPI) {
              return;
            }
            setIsSaving(true);
            try {
              await saveSnapshot(
                token,
                excalidrawAPI.getSceneElements(),
                excalidrawAPI.getAppState(),
                excalidrawAPI.getFiles(),
                title,
              );
              setIsOpen(false);
            } catch (error) {
              console.error("Save snapshot failed", error);
            } finally {
              setIsSaving(false);
            }
          }}
        />
      )}
    </>
  );
};
