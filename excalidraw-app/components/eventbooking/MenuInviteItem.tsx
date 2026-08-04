import { useState } from "react";
import { MainMenu } from "../../../packages/excalidraw/index";
import { usersIcon } from "../../../packages/excalidraw/components/icons";
import { Dialog } from "../../../packages/excalidraw/components/Dialog";
import { inviteManager, type InviteResponse } from "../../data/backendSync";

/**
 * "Пригласить менеджера площадки" — делает чат видимым в общем списке
 * (ChatProduct.manager_invited_at) и показывает контакты подрядчика.
 */
export const MenuInviteItem = ({ token }: { token: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async (event: Event) => {
    // Без preventDefault() клик по MainMenu.Item закрывает и размонтирует
    // весь DropdownMenu.Content вместе с этим компонентом и его isOpen.
    event.preventDefault();
    setIsOpen(true);
    setIsLoading(true);
    setError(null);
    try {
      const response = await inviteManager(token);
      setResult(response);
    } catch {
      setError("Не удалось пригласить менеджера площадки");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <MainMenu.Item icon={usersIcon} onSelect={handleClick}>
        Пригласить менеджера площадки
      </MainMenu.Item>
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
                  {result.already_invited
                    ? "Менеджер уже приглашён в этот чат."
                    : "Менеджер площадки приглашён в чат."}
                </p>
                {result.contacts.phone && <p>Телефон: {result.contacts.phone}</p>}
                {result.contacts.whatsapp && (
                  <p>WhatsApp: {result.contacts.whatsapp}</p>
                )}
                {result.contacts.telegram && (
                  <p>Telegram: {result.contacts.telegram}</p>
                )}
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
};
