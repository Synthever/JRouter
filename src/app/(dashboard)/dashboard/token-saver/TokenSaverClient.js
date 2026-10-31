"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button, Input, Modal, SegmentedControl, Toggle, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";
import StrategyRow from "./components/StrategyRow";
import styles from "./token-saver.module.css";

const PIP_INSTALL_COMMAND = 'pip install "headroom-ai[proxy]"';
const STRATEGY_COUNT = 4;

export default function TokenSaverClient() {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomTimeoutMs, setHeadroomTimeoutMs] = useState(3000);
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true,
  });
  const [showHeadroomInstallModal, setShowHeadroomInstallModal] =
    useState(false);
  const [headroomActionLoading, setHeadroomActionLoading] = useState(false);
  const [headroomActionError, setHeadroomActionError] = useState("");
  const [headroomExtras, setHeadroomExtras] = useState({
    version: null,
    extras: { code: false, ml: false },
    available: ["code", "ml"],
    loading: false,
  });
  const [pendingExtras, setPendingExtras] = useState([]);
  const [extrasActionLoading, setExtrasActionLoading] = useState(false);
  const [extrasActionError, setExtrasActionError] = useState("");
  const [removingExtra, setRemovingExtra] = useState(null);
  const [installLog, setInstallLog] = useState("");
  const [extrasConfirm, setExtrasConfirm] = useState(null);
  const [codeAware, setCodeAware] = useState(false);
  const [kompress, setKompress] = useState(true);
  const [restartingProxy, setRestartingProxy] = useState(false);
  const logPollRef = useRef(null);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [locale, setLocale] = useState("en");

  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    setLocale(getCurrentLocale());
    return onLocaleChange(() => setLocale(getCurrentLocale()));
  }, []);

  const isWenyanLocale = WENYAN_LOCALES.includes(locale);
  const visibleCavemanLevels = isWenyanLocale
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((lvl) => !lvl.wenyan);

  useEffect(() => {
    const current = CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel);
    if (current?.wenyan && !isWenyanLocale) {
      setCavemanLevel("ultra");
      patchSetting({ cavemanLevel: "ultra" });
    }
  }, [isWenyanLocale, cavemanLevel]);

  const patchSetting = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.log("Error updating setting:", error);
    }
  };

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.log("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleHeadroomEnabled = (value) => {
    const nextUrl = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(nextUrl);
    setHeadroomEnabled(value);
    patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleHeadroomUrlBlur = async () => {
    const next = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(next);
    await patchSetting({ headroomUrl: next });
    refreshHeadroomStatus();
  };

  const refreshHeadroomStatus = useCallback(async () => {
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setHeadroomStatus({ ...data, loading: false });
      if (!data?.installed) {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
        return;
      }
      try {
        const er = await fetch("/api/headroom/extras", {
          headers: { "Cache-Control": "no-store" },
        });
        if (!er.ok) throw new Error("extras status failed");
        const ed = await er.json();
        setHeadroomExtras((s) => ({
          ...s,
          version: ed.version ?? null,
          extras: ed.extras || { code: false, ml: false },
          available: ed.available || ["code", "ml"],
          loading: false,
        }));
        setPendingExtras([]);
      } catch {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
      }
    } catch {
      setHeadroomStatus({
        installed: false,
        running: false,
        python: null,
        loading: false,
      });
      setHeadroomExtras({
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      });
      setPendingExtras([]);
    }
  }, []);

  const handleHeadroomStart = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to start proxy");
      await refreshHeadroomStatus();
    } catch (e) {
      setHeadroomActionError(e.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleHeadroomStop = useCallback(async () => {
    setHeadroomActionLoading(true);
    try {
      await fetch("/api/headroom/stop", { method: "POST" });
      await refreshHeadroomStatus();
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const togglePendingExtra = (extra) => {
    setPendingExtras((cur) =>
      cur.includes(extra) ? cur.filter((e) => e !== extra) : [...cur, extra]
    );
  };

  // Poll the install log tail while a pip install/uninstall is running.
  const startLogPolling = useCallback(() => {
    setInstallLog("");
    if (logPollRef.current) clearInterval(logPollRef.current);
    const tick = async () => {
      try {
        const r = await fetch("/api/headroom/extras?log=1", {
          headers: { "Cache-Control": "no-store" },
        });
        const d = await r.json().catch(() => ({}));
        if (typeof d.log === "string") setInstallLog(d.log);
      } catch { /* ignore transient poll errors */ }
    };
    tick();
    logPollRef.current = setInterval(tick, 1500);
  }, []);

  const stopLogPolling = useCallback(() => {
    if (logPollRef.current) {
      clearInterval(logPollRef.current);
      logPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopLogPolling(), [stopLogPolling]);

  const installExtrasConfirmed = useCallback(async () => {
    if (pendingExtras.length === 0) return;
    setExtrasActionLoading(true);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: pendingExtras }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Install failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
      setPendingExtras([]);
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setExtrasActionLoading(false);
    }
  }, [pendingExtras, startLogPolling, stopLogPolling]);

  const removeExtraConfirmed = useCallback(async (extra) => {
    setRemovingExtra(extra);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: [extra] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Remove failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setRemovingExtra(null);
    }
  }, [startLogPolling, stopLogPolling]);

  const handleInstallExtras = useCallback(() => {
    if (pendingExtras.length === 0) return;
    // Warn about the heavy ~1GB torch download before installing [ml].
    if (pendingExtras.includes("ml")) {
      setExtrasConfirm({
        title: "Install [ml]",
        message: "[ml] downloads ~1 GB (torch + huggingface-hub). Continue?",
        confirmText: "Install",
        variant: "primary",
        onConfirm: installExtrasConfirmed,
      });
      return;
    }
    installExtrasConfirmed();
  }, [pendingExtras, installExtrasConfirmed]);

  const handleRemoveExtra = useCallback((extra) => {
    setExtrasConfirm({
      title: `Remove [${extra}]`,
      message: `Remove [${extra}] and its packages?`,
      confirmText: "Remove",
      variant: "danger",
      onConfirm: () => removeExtraConfirmed(extra),
    });
  }, [removeExtraConfirmed]);

  // Toggle an extra's active state (persist setting), then restart the proxy so
  // the new --code-aware / --disable-kompress flags take effect.
  const toggleExtraActive = useCallback(async (extra, value) => {
    setExtrasActionError("");
    if (extra === "code") setCodeAware(value);
    if (extra === "ml") setKompress(value);
    const key = extra === "code" ? "headroomCodeAware" : "headroomKompress";
    await patchSetting({ [key]: value });
    if (!headroomStatus.running) return;
    setRestartingProxy(true);
    try {
      const res = await fetch("/api/headroom/restart", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Restart failed");
      await refreshHeadroomStatus();
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      setRestartingProxy(false);
    }
  }, [headroomStatus.running, refreshHeadroomStatus]);

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  const handleHeadroomTimeoutBlur = () => {
    const raw = Math.round(Number(headroomTimeoutMs));
    const next = Number.isFinite(raw) && raw > 0 ? raw : 3000;
    setHeadroomTimeoutMs(next);
    patchSetting({ headroomTimeoutMs: next });
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setRtkEnabledState(data.rtkEnabled !== false);
          setHeadroomEnabled(!!data.headroomEnabled);
          setHeadroomUrl(data.headroomUrl || "http://localhost:8787");
          if (typeof data.headroomTimeoutMs === "number") setHeadroomTimeoutMs(data.headroomTimeoutMs);
          setCodeAware(data.headroomCodeAware === true);
          setKompress(data.headroomKompress !== false);
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
          setPonytailEnabled(!!data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || "full");
          refreshHeadroomStatus();
        }
      } catch {}
    };
    loadSettings();
  }, [refreshHeadroomStatus]);

  const headroomRunning = !!headroomStatus.running;
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
    headroomLocalUrl && !!headroomStatus.managedPid;
  const headroomStatusLabel = headroomStatus.loading
    ? "Checking…"
    : headroomRunning
      ? "Running"
      : !headroomLocalUrl
        ? "External"
        : headroomStatus.installed
          ? "Stopped"
          : "Not installed";
  const headroomBadgeClass = headroomStatus.loading
    ? ""
    : headroomRunning
      ? styles.badgeOn
      : styles.badgeWarn;
  const headroomCanManage = headroomLocalUrl && (headroomRunning || headroomCanStart || !headroomStatus.installed);

  const cavemanLevelOptions = useMemo(
    () => visibleCavemanLevels.map((lvl) => ({ value: lvl.id, label: lvl.label, title: lvl.desc })),
    [visibleCavemanLevels]
  );
  const ponytailLevelOptions = useMemo(
    () => PONYTAIL_LEVELS.map((lvl) => ({ value: lvl.id, label: lvl.label, title: lvl.desc })),
    []
  );

  const activeCount = [rtkEnabled, headroomEnabled, cavemanEnabled, ponytailEnabled]
    .filter(Boolean).length;

  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.intro}>
        <h1 className={styles.title}>Token Saver</h1>
        <p className={styles.sub}>
          Request-time compression that cuts prompt and completion tokens before they reach the model
        </p>
      </header>

      <section className={styles.section} aria-labelledby="token-saver-strategies-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="token-saver-strategies-heading" className={styles.sectionTitle}>
              <Icon className={styles.sectionIcon}>list_alt</Icon> Strategies
              <small>{activeCount} of {STRATEGY_COUNT} active</small>
            </h2>
            <p className={styles.sectionDescription}>
              Each strategy is applied independently. Changes save immediately.
            </p>
          </div>
        </div>

        <StrategyRow
          icon="bolt"
          tone="lavender"
          title="Compress tool output"
          doc="RTK"
          docHref="https://github.com/rtk-ai/rtk"
          active={rtkEnabled}
          description="git/grep/ls/tree/logs → 60-90% fewer input tokens"
          control={
            <Toggle
              checked={rtkEnabled}
              onChange={() => handleRtkEnabled(!rtkEnabled)}
              aria-label="Compress tool output (RTK)"
            />
          }
        />

        <StrategyRow
          icon="layers"
          tone="ochre"
          title="Compress context"
          doc="Headroom"
          docHref="https://github.com/chopratejas/headroom"
          active={headroomEnabled}
          description="Compress prompts via /v1/compress before routing to the model"
          control={
            <>
              <span className={`${styles.badge} ${headroomBadgeClass}`}>
                <i className={styles.dot} aria-hidden="true" />
                {headroomStatusLabel}
              </span>
              {headroomCanManage && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowHeadroomInstallModal(true)}
                >
                  {headroomRunning ? "Manage" : "Setup"}
                </Button>
              )}
              <Toggle
                checked={headroomEnabled}
                onChange={() => handleHeadroomEnabled(!headroomEnabled)}
                aria-label="Compress context (Headroom)"
              />
            </>
          }
        />

        <StrategyRow
          icon="record_voice_over"
          tone="pink"
          title="Compress LLM output"
          doc="Caveman"
          docHref="https://github.com/JuliusBrussee/caveman"
          active={cavemanEnabled}
          description="Terse-style system prompt → ~65% fewer output tokens (up to 87%)"
          control={
            <>
              {cavemanEnabled && (
                <div className={styles.levels}>
                  <SegmentedControl
                    className={styles.segmented}
                    options={cavemanLevelOptions}
                    value={cavemanLevel}
                    onChange={handleCavemanLevel}
                    size="sm"
                    aria-label="Caveman compression level"
                  />
                  <p className={styles.levelHint}>
                    {CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel)?.desc}
                  </p>
                </div>
              )}
              <Toggle
                checked={cavemanEnabled}
                onChange={() => handleCavemanEnabled(!cavemanEnabled)}
                aria-label="Compress LLM output (Caveman)"
              />
            </>
          }
        />

        <StrategyRow
          icon="code"
          tone="mint"
          title="Lazy senior dev"
          doc="Ponytail"
          docHref="https://github.com/DietrichGebert/ponytail"
          active={ponytailEnabled}
          description="Bias the model toward minimal code: YAGNI, reuse stdlib, deletion over addition"
          control={
            <>
              {ponytailEnabled && (
                <div className={styles.levels}>
                  <SegmentedControl
                    className={styles.segmented}
                    options={ponytailLevelOptions}
                    value={ponytailLevel}
                    onChange={handlePonytailLevel}
                    size="sm"
                    aria-label="Ponytail level"
                  />
                  <p className={styles.levelHint}>
                    {PONYTAIL_LEVELS.find((lvl) => lvl.id === ponytailLevel)?.desc}
                  </p>
                </div>
              )}
              <Toggle
                checked={ponytailEnabled}
                onChange={() => handlePonytailEnabled(!ponytailEnabled)}
                aria-label="Lazy senior dev (Ponytail)"
              />
            </>
          }
        />
      </section>

      <Modal
        className={styles.dialog}
        isOpen={showHeadroomInstallModal}
        title={headroomRunning ? "Headroom" : "Setup Headroom"}
        size="lg"
        onClose={() => setShowHeadroomInstallModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className={styles.statusRow}>
            <span>Status</span>
            <span className={`${styles.badge} ${headroomBadgeClass}`}>
              <i className={styles.dot} aria-hidden="true" />
              {headroomStatusLabel}
            </span>
          </div>
          {headroomRunning && (
            <a
              href="/api/headroom/proxy/dashboard"
              target="_blank"
              rel="noreferrer"
              className={styles.linkButton}
            >
              Open Headroom Dashboard
            </a>
          )}
          <Input
            label="Proxy URL"
            value={headroomUrl}
            onChange={(e) => setHeadroomUrl(e.target.value)}
            onBlur={handleHeadroomUrlBlur}
            placeholder="http://localhost:8787"
            hint="Use a local proxy for Start/Stop, or an external Docker sidecar like http://headroom:8787."
            inputClassName="font-mono text-xs"
          />
          <Input
            label="Timeout (ms)"
            value={String(headroomTimeoutMs)}
            onChange={(e) => setHeadroomTimeoutMs(e.target.value)}
            onBlur={handleHeadroomTimeoutBlur}
            placeholder="3000"
            hint="Request timeout in milliseconds. Defaults to 3000 ms."
            inputClassName="font-mono text-xs"
          />
          {headroomManaged ? (
            <Button
              onClick={handleHeadroomStop}
              variant="ghost"
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Stopping…" : "Stop Headroom"}
            </Button>
          ) : headroomRunning ? (
            <p className={styles.progressNote}>
              Headroom proxy is reachable. You can enable the token saver.
            </p>
          ) : headroomCanStart ? (
            <Button
              onClick={handleHeadroomStart}
              variant="contrast"
              fullWidth
              disabled={headroomActionLoading}
            >
              {headroomActionLoading ? "Starting…" : "Start Headroom"}
            </Button>
          ) : !headroomLocalUrl ? (
            <p className={styles.notice}>
              Start Headroom separately at the configured URL, then recheck.
            </p>
          ) : !headroomStatus.python ? (
            <p className={styles.notice}>
              Python ≥ 3.10 required for local managed mode. Install Python first, or use an
              external proxy URL.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className={styles.fieldLabel}>Install then click Start</p>
              <div className={styles.installCommand}>
                <code className="flex-1">{PIP_INSTALL_COMMAND}</code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => copy(PIP_INSTALL_COMMAND)}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          {headroomStatus.installed && (
            <div className={styles.extras}>
              <div className={styles.extrasHeader}>
                <span className={styles.extrasMeta}>
                  Compression extras{headroomExtras.version ? ` · v${headroomExtras.version}` : ""}
                </span>
                {pendingExtras.length > 0 && (
                  <Button
                    size="sm"
                    variant="contrast"
                    onClick={handleInstallExtras}
                    disabled={extrasActionLoading}
                    loading={extrasActionLoading}
                  >
                    {`Install [proxy,${pendingExtras.join(",")}]`}
                  </Button>
                )}
              </div>

              <div className={styles.chips}>
                {headroomExtras.available.map((extra) => {
                  const installed = !!headroomExtras.extras[extra];
                  const pending = pendingExtras.includes(extra);
                  const extraTitle =
                    extra === "code"
                      ? "tree-sitter AST compression for code responses"
                      : "Kompress-v2 HF model for prose/agentic traces (~+1GB)";

                  if (installed) {
                    const active = extra === "code" ? codeAware : kompress;
                    return (
                      <div
                        key={extra}
                        className={styles.chip}
                        data-installed="true"
                        title={extraTitle}
                      >
                        <Toggle
                          size="sm"
                          checked={active}
                          disabled={restartingProxy}
                          onChange={() => toggleExtraActive(extra, !active)}
                          aria-label={`${active ? "Disable" : "Enable"} [${extra}]`}
                        />
                        <span>[{extra}]</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveExtra(extra)}
                          disabled={removingExtra === extra}
                          className={styles.uninstall}
                          title={`Uninstall [${extra}]`}
                        >
                          {removingExtra === extra ? "Uninstalling…" : "Uninstall"}
                        </button>
                      </div>
                    );
                  }

                  return (
                    <label
                      key={extra}
                      className={styles.chip}
                      data-selected={pending ? "true" : "false"}
                      title={extraTitle}
                    >
                      <input
                        type="checkbox"
                        checked={pending}
                        onChange={() => togglePendingExtra(extra)}
                      />
                      <span>[{extra}]</span>
                      <span className={styles.chipNote}>not installed</span>
                    </label>
                  );
                })}
              </div>

              {extrasActionError && <p className={styles.notice}>{extrasActionError}</p>}
              {restartingProxy && <p className={styles.progressNote}>Restarting proxy…</p>}
              {(extrasActionLoading || removingExtra) && installLog && (
                <pre className={styles.installLog}>{installLog}</pre>
              )}
              <p className={styles.extrasHelp}>
                Installing adds the package; use <code>on</code>/<code>off</code> to activate it
                (restarts the proxy). Default install is <code>[proxy]</code> only (SmartCrusher for
                JSON). Adding <code>[code]</code> enables AST compression
                (Python/JS/TS/Go/Rust/Java/C/C++/Perl). Adding <code>[ml]</code> enables the
                Kompress-v2 HF model for prose/agentic traces but adds ~1 GB (torch +
                huggingface-hub).
              </p>
            </div>
          )}

          {headroomActionError && <p className={styles.notice}>{headroomActionError}</p>}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshHeadroomStatus()}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button
              onClick={() => setShowHeadroomInstallModal(false)}
              variant="contrast"
              fullWidth
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        className={styles.dialog}
        isOpen={!!extrasConfirm}
        onClose={() => setExtrasConfirm(null)}
        onConfirm={() => {
          const fn = extrasConfirm?.onConfirm;
          setExtrasConfirm(null);
          fn?.();
        }}
        title={extrasConfirm?.title}
        message={extrasConfirm?.message}
        confirmText={extrasConfirm?.confirmText}
        variant={extrasConfirm?.variant}
      />
    </div>
  );
}
