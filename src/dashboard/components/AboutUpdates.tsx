import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  APP_VERSION,
  RELEASES_URL,
  appInfoSchema,
  updateCheckSchema,
  type AppInfo,
  type UpdateCheck,
} from "../../shared/app-info.ts";

const errorSchema = z.object({ error: z.string() });

export function AboutUpdates({ onClose }: { readonly onClose: () => void }): ReactNode {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checkController = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/app", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not read the installed application version. Restart the application and reload this dashboard.");
        }
        const parsed = appInfoSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error("The server information does not match this dashboard. Install the complete matching release and reload.");
        }
        setInfo(parsed.data);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setInfoError(requestError instanceof Error ? requestError.message : "The local server could not be reached.");
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      checkController.current?.abort();
    };
  }, []);

  const check = async (): Promise<void> => {
    const controller = new AbortController();
    checkController.current = controller;
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/updates/check", {
        method: "POST",
        signal: controller.signal,
        cache: "no-store",
      });
      const input: unknown = await response.json();
      if (!response.ok) {
        const parsed = errorSchema.safeParse(input);
        throw new Error(parsed.success ? parsed.data.error : "Updates could not be checked. Try again later.");
      }
      const parsed = updateCheckSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error("The update information could not be read. Open the releases page instead.");
      }
      setResult(parsed.data);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(requestError instanceof Error ? requestError.message : "Updates could not be checked.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setChecking(false);
      }
    }
  };
  const platform = info?.target === "macos-arm64" ? "macOS / Apple Silicon"
    : info?.target === "macos-x64" ? "macOS / Intel"
      : info?.target === "windows-x64" ? "Windows / x64"
        : info?.target === "linux-x64" ? "Linux / x64"
          : info === null ? null : `${info.platform} / ${info.architecture}`;

  return (
    <section className="about-panel" aria-labelledby="about-title">
      <div className="about-panel__heading">
        <h2 id="about-title" ref={heading} tabIndex={-1}>About &amp; updates</h2>
        <button type="button" className="button button--small button--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="about-panel__facts">
        <div><dt>Installed application</dt><dd>{info === null ? "Reading local version..." : `v${info.version}`}</dd></div>
        <div><dt>Dashboard</dt><dd>v{APP_VERSION}</dd></div>
        {platform !== null && <div><dt>Package platform</dt><dd>{platform}</dd></div>}
      </dl>
      {infoError !== null && <p className="about-panel__error" role="alert">{infoError}</p>}
      <p>
        Check for stable releases when you choose. No GitHub account is needed.
        Nothing is downloaded, installed, or restarted automatically.
      </p>
      <div className="about-panel__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={checking || info === null}
          onClick={() => void check()}
        >
          {checking ? "Checking GitHub..." : "Check for updates"}
        </button>
        <a href={RELEASES_URL} target="_blank" rel="noreferrer">All releases</a>
      </div>
      {error !== null && <p className="about-panel__error" role="alert">{error}</p>}
      <div className="about-panel__result" role="status" aria-live="polite" aria-atomic="true">
        {result !== null && (
          <>
            <h3>
              {result.status === "available" ? `Version ${result.latestVersion} is available`
                : result.status === "current" ? "You have the latest stable release"
                  : "This installation is newer than the latest stable release"}
            </h3>
            <p>Last successful check: {new Date(result.checkedAt).toLocaleString()}. Successful checks are cached for five minutes.</p>
          </>
        )}
      </div>
      {result !== null && (
        <div className="about-panel__downloads">
          {result.status === "available" && (
            result.download === null
              ? <p>No matching native package was listed for this runtime. Choose a compatible package on the release page.</p>
              : <a className="button button--load" href={result.download.url}>
                Download for {platform}
              </a>
          )}
          <a href={result.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>
          {result.checksumsUrl !== null && (
            <a href={result.checksumsUrl} target="_blank" rel="noreferrer">SHA-256 checksums</a>
          )}
        </div>
      )}
      <section className="about-panel__upgrade" aria-labelledby="upgrade-title">
        <h3 id="upgrade-title">Upgrade between broadcasts</h3>
        <p>
          Finish your broadcast, quit the application, then replace the complete
          app or install the new package. Portable users must replace the executable
          and its public folder together. Never mix files from different releases.
        </p>
        <p>
          Your API token and operator settings stay in your user configuration
          directory, outside the installation. Reopen the app, reload this dashboard,
          and refresh the OBS browser source. The default OBS URL stays the same.
        </p>
        <p>
          State migrations create a backup before changing the saved format.
          Downgrading may require restoring that backup with the application stopped;
          an older version may not understand newer settings.
        </p>
      </section>
    </section>
  );
}
