import { useState } from "react";
import { MainMenu } from "../../../packages/excalidraw/index";
import { LoadIcon } from "../../../packages/excalidraw/components/icons";
import type { EventBookingParams } from "../../data/backendSync";
import { BoardPickerDialog } from "./BoardPickerDialog";

/**
 * Заменяет стоковую "Открыть" (загрузка .excalidraw-файла с диска) — список
 * досок пользователя (автосохранения + ручные сохранения) с сервера
 * EventBooking.
 */
export const MenuOpenItem = ({
  eventBookingParams,
  onReissueToken,
  onApplyScene,
}: {
  eventBookingParams: EventBookingParams;
  onReissueToken: (chatId: number) => Promise<EventBookingParams | null>;
  onApplyScene: (
    scene: { elements?: unknown; appState?: unknown; files?: unknown } | null,
    planImageUrl: string | null,
  ) => Promise<void>;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <MainMenu.Item
        icon={LoadIcon}
        onSelect={(event) => {
          // См. комментарий в MenuSaveItem.tsx — без preventDefault() меню
          // закроется и размонтирует диалог раньше, чем он успеет открыться.
          event.preventDefault();
          setIsOpen(true);
        }}
      >
        Открыть
      </MainMenu.Item>
      {isOpen && (
        <BoardPickerDialog
          token={eventBookingParams.token}
          onClose={() => setIsOpen(false)}
          onReissueToken={onReissueToken}
          onApplyScene={onApplyScene}
        />
      )}
    </>
  );
};
