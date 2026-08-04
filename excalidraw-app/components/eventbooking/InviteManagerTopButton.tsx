import { useState } from "react";
import { Button } from "../../../packages/excalidraw/components/Button";
import { usersIcon } from "../../../packages/excalidraw/components/icons";
import { Dialog } from "../../../packages/excalidraw/components/Dialog";
import type { CollabAPI } from "../../collab/Collab";
import { inviteManager, type InviteResponse } from "../../data/backendSync";
import { stripEventBookingParamsFromRoomLink } from "../../data";
import "./InviteManagerTopButton.scss";

/**
 * Копия кнопки "Поделиться" (LiveCollaborationTrigger) в верхней панели —
 * тот же визуальный стиль (см. InviteManagerTopButton.scss), но вместо
 * Live-коллаборации запускает её АВТОМАТИЧЕСКИ (если ещё не запущена) и
 * приглашает менеджера площадки присоединиться к этой же живой комнате:
 * ссылка в сообщении ведёт на #room=..., а не на обычный chatId+token —
 * перейдя по ней, подрядчик попадёт в ту же сессию, что и пользователь,
 * с совместным просмотром в реальном времени.
 *
 * startCollaboration(null) безопасен для уже загруженной сцены — он не
 * сбрасывает elements (см. Collab.tsx), только помечает уже вставленные
 * картинки (включая план помещения) "pending", чтобы их файлы переехали в
 * новую комнату через наш room-file relay (DrawingController::
 * actionSaveRoomFiles) — то есть план помещения останется виден и
 * присоединившемуся подрядчику.
 */
export const InviteManagerTopButton = ({
  token,
  collabAPI,
}: {
  token: string;
  collabAPI: CollabAPI | null;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setIsOpen(true);
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      if (collabAPI && !collabAPI.isCollaborating()) {
        await collabAPI.startCollaboration(null);
      }
      const rawRoomLink = collabAPI?.getActiveRoomLink() || null;
      // rawRoomLink может содержать chatId/token ЭТОГО пользователя (см.
      // getCollaborationLink) — получателю нельзя отправлять его как есть,
      // иначе он сможет действовать под чужой личностью.
      const roomLink = rawRoomLink
        ? stripEventBookingParamsFromRoomLink(rawRoomLink)
        : null;
      const response = await inviteManager(token, roomLink);
      setResult(response);
    } catch {
      setError("Не удалось пригласить менеджера площадки");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        className="invite-manager-button"
        onSelect={handleClick}
        style={{ width: "auto" }}
        title="Пригласить менеджера площадки"
      >
        {usersIcon} Пригласить менеджера
      </Button>
      {isOpen && (
        <Dialog
          size="small"
          onCloseRequest={() => setIsOpen(false)}
          title="Менеджер площадки"
        >
          <div style={{ padding: "0 1rem 1rem" }}>
            {isLoading && <p>Отправка приглашения…</p>}
            {error && <p>{error}</p>}
            {result && (
              <>
                <p>
                  Приглашение присоединиться к совместному просмотру
                  отправлено в чат.
                </p>
                {result.contacts.phone && <p>Телефон: {result.contacts.phone}</p>}
                {result.contacts.whatsapp && (
                  <p>WhatsApp: {result.contacts.whatsapp}</p>
                )}
                {result.contacts.telegram && (
                  <p>Telegram: {result.contacts.telegram}</p>
                )}
                <p>
                  <a
                    className="invite-manager-chat-link"
                    href={result.chat_link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Перейти к сообщению в чат
                  </a>
                </p>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
};
