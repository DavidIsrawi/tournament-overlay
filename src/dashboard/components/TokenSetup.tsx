import {
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

export function TokenSetup({
  canCancel,
  onCancel,
  onSaved,
}: {
  readonly canCancel: boolean;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}): ReactNode {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedToken = token.trim();
    if (trimmedToken.length === 0) {
      setStatus("Enter your StartGG API token.");
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch("/api/settings/startgg-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: trimmedToken }),
      });
      if (!response.ok) {
        setStatus(
          response.status === 400
            ? "Enter a valid StartGG API token."
            : "The token could not be saved. Try again.",
        );
        return;
      }
      setToken("");
      setStatus("Token saved locally.");
      onSaved();
    } catch (requestError) {
      setStatus(
        requestError instanceof Error
          ? `The local server could not save the token: ${requestError.message}`
          : "The local server could not save the token.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="setup-screen">
      <section className="setup-panel" aria-labelledby="setup-title">
        <div className="setup-panel__identity">
          <div className="mini-helm" aria-hidden="true">
            TO
          </div>
          <div>
            <strong>Tournament Overlay</strong>
            <span>Local broadcast control</span>
          </div>
        </div>
        <div className="setup-panel__content">
          <h1 id="setup-title">Connect StartGG</h1>
          <p>
            Add a personal API token to load tournament brackets and keep your
            OBS overlay synchronized.
          </p>
          <form className="token-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="startgg-token">Personal API token</label>
            <input
              id="startgg-token"
              name="startgg-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              placeholder="Paste token"
              onChange={(event) => setToken(event.target.value)}
            />
            <div className="token-form__actions">
              <button
                className="button button--load"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save and continue"}
              </button>
              {canCancel && (
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={onCancel}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          <p className="setup-panel__privacy">
            The token is remembered in this user account's local configuration
            file with owner-only permissions. It is never included in dashboard
            state or sent to OBS.
          </p>
          <a
            href="https://www.start.gg/admin/profile/developer"
            target="_blank"
            rel="noreferrer"
          >
            Create a token in StartGG Developer Settings
          </a>
          <output className="setup-panel__status" aria-live="polite">
            {status}
          </output>
        </div>
      </section>
    </main>
  );
}
