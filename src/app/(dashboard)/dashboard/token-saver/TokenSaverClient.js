"use client";
import Icon from "@/shared/components/Icon";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button, Input, Modal, SegmentedControl, Toggle, ConfirmModal } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";
import {
  WENYAN_LOCALES,
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";
import styles from "./token-saver.module.css";

const PIP_INSTALL_COMMAND = 'pip install "headroom-ai[proxy]"';

function StrategyRow({ icon, title, doc, docHref, active, description, control, children }) {
  return (
    <div className={styles.strategy}>
      <div className={styles.strategyHeader}>
        <div className={styles.identity}>
          <Icon className="shrink-0 text-[16px] text-[var(--text-2)]">{icon}</Icon>
          <div className="min-w-0">
            <div className={styles.titleLine}>
              <span className={styles.title}>{title}</span>
              <a
                href={docHref}
                target="_blank"
                rel="noreferrer"
                className={styles.docLink}
              >
                {doc}
              </a>
              <StatusBadge variant={active ? "success" : "default"}>
                {active ? "Active" : "Off"}
              </StatusBadge>
            </div>
            <p className={styles.metadata}>{description}</p>
          </div>
        </div>
        <div className={styles.actions}>{control}</div>
      </div>
      {children}
    </div>
  );
}

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
  const [pxpipeEnabled, setPxpipeEnabled] = useState(false);
  const [pxpipeMinChars, setPxpipeMinChars] = useState(25000);
  const [pxpipeStatus, setPxpipeStatus] = useState({
    installed: false,
    installing: false,
    running: false,
    version: null,
    loading: true,
  });
  const [pxpipeHealth, setPxpipeHealth] = useState(null);
  const [showPxpipeModal, setShowPxpipeModal] = useState(false);
  const [pxpipeActionLoading, setPxpipeActionLoading] = useState(false);
  const [pxpipeActionError, setPxpipeActionError] = useState("");
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

  const refreshPxpipeStatus = useCallback(async () => {
    setPxpipeStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/pxpipe/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setPxpipeStatus({ ...data, loading: false });
      if (typeof data.minChars === "number") setPxpipeMinChars(data.minChars);
    } catch {
      setPxpipeStatus({ installed: false, installing: false, running: false, version: null, loading: false });
    }
  }, []);

  const runPxpipeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/pxpipe/health", { method: "POST" });
      setPxpipeHealth(await res.json());
    } catch (e) {
      setPxpipeHealth({ healthy: false, checks: [], error: e.message });
    }
  }, []);

  const pxpipeAction = useCallback(
    async (endpoint) => {
      setPxpipeActionError("");
      setPxpipeActionLoading(true);
      try {
        const res = await fetch(`/api/pxpipe/${endpoint}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `PXPIPE ${endpoint} failed`);
        await refreshPxpipeStatus();
        await runPxpipeHealth();
      } catch (e) {
        setPxpipeActionError(e.message);
      } finally {
        setPxpipeActionLoading(false);
      }
    },
    [refreshPxpipeStatus, runPxpipeHealth]
  );

  const handlePxpipeEnabled = (value) => {
    setPxpipeEnabled(value);
    patchSetting({ pxpipeEnabled: value });
  };

  const handlePxpipeMinCharsBlur = () => {
    const next = Math.max(0, Number(pxpipeMinChars) || 25000);
    setPxpipeMinChars(next);
    patchSetting({ pxpipeMinChars: next });
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
          setPxpipeEnabled(!!data.pxpipeEnabled);
          if (typeof data.pxpipeMinChars === "number") setPxpipeMinChars(data.pxpipeMinChars);
          refreshHeadroomStatus();
          // PRD: run the PXPIPE health check automatically when the page opens
          refreshPxpipeStatus().then(runPxpipeHealth);
        }
      } catch {}
    };
    loadSettings();
  }, [refreshHeadroomStatus, refreshPxpipeStatus, runPxpipeHealth]);

  const headroomRunning = !!headroomStatus.running;
  const headroomStatusLabel = headroomStatus.loading
    ? "Checking…"
    : headroomRunning
      ? "Running"
      : headroomStatus.localUrl !== false && !headroomStatus.installed
        ? "Not installed"
        : headroomStatus.localUrl !== false
          ? "Stopped"
          : "External";
  const headroomLocalUrl = headroomStatus.localUrl !== false;
  const headroomCanStart = !!headroomStatus.canStart;
  const headroomManaged =
    headroomLocalUrl && !!headroomStatus.managedPid;
  const headroomBadgeVariant = headroomStatus.loading
    ? "default"
    : headroomRunning
      ? "success"
      : "warning";
  const headroomCanManage = headroomLocalUrl && (headroomRunning || headroomCanStart || !headroomStatus.installed);

  const pxpipeHealthy = pxpipeHealth?.healthy === true;
  const pxpipeStatusLabel = pxpipeStatus.loading
    ? "Checking…"
    : pxpipeStatus.installing
      ? "Installing…"
      : !pxpipeStatus.installed
        ? "Not installed"
        : pxpipeHealthy
          ? "Healthy"
          : pxpipeStatus.running
            ? "Running"
            : "Stopped";

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
      <header className={styles.header}>
        <div className="min-w-0">
          <h1 className="ui-eyebrow flex items-center gap-2">
            <Icon className="text-[16px]">bolt</Icon> Token Saver
          </h1>
          <p className={styles.description}>
            Request-time compression that cuts prompt and completion tokens before they reach the model
          </p>
        </div>
        <div className={styles.summary}>
          <StatusBadge variant={activeCount > 0 ? "success" : "default"}>
            {activeCount} of 4 strategies active
          </StatusBadge>
        </div>
      </header>

      <section className={`ui-card ${styles.section}`} aria-labelledby="token-saver-strategies-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="token-saver-strategies-heading" className="ui-eyebrow flex items-center gap-2">
              <Icon className="text-[16px]">list_alt</Icon> Strategies
            </h2>
            <p className={styles.sectionDescription}>
              Each strategy is applied independently. Changes save immediately.
            </p>
          </div>
        </div>

        <StrategyRow
          icon="bolt"
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
          title="Compress context"
          doc="Headroom"
          docHref="https://github.com/chopratejas/headroom"
          active={headroomEnabled}
          description="Compress prompts via /v1/compress before routing to the model"
          control={
            <>
              <StatusBadge variant={headroomBadgeVariant}>{headroomStatusLabel}</StatusBadge>
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
        >
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
        </StrategyRow>

        <StrategyRow
          icon="record_voice_over"
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

        {/* PXPIPE hidden from UI — experimental, not exposed to users yet */}
        {false && (
          <StrategyRow
            icon="image"
            title="Compress prompts as images"
            doc="PXPIPE"
            docHref="https://github.com/teamchong/pxpipe"
            active={pxpipeEnabled}
            description="Transforms large textual context into optimized images before sending to the LLM. Ideal for huge prompts, tool outputs and long conversations."
            control={
              <>
                <StatusBadge variant={pxpipeHealthy || pxpipeStatus.running ? "success" : "warning"}>
                  {pxpipeStatusLabel}
                </StatusBadge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowPxpipeModal(true)}
                >
                  {pxpipeStatus.installed ? "Manage" : "Setup"}
                </Button>
                <a href="/dashboard/pxpipe" className={styles.docLink}>Dashboard</a>
                <Toggle
                  checked={pxpipeEnabled}
                  disabled={!pxpipeStatus.installed}
                  onChange={() => handlePxpipeEnabled(!pxpipeEnabled)}
                  aria-label="Compress prompts as images (PXPIPE)"
                />
              </>
            }
          />
        )}
      </section>

      <Modal
        className={styles.dialog}
        isOpen={showHeadroomInstallModal}
        title={headroomRunning ? "Headroom" : "Setup Headroom"}
        onClose={() => setShowHeadroomInstallModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className={styles.statusRow}>
            <span>Status</span>
            <StatusBadge variant={headroomBadgeVariant}>{headroomStatusLabel}</StatusBadge>
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

      <Modal
        className={styles.dialog}
        isOpen={false}
        title={pxpipeStatus.installed ? "PXPIPE" : "Setup PXPIPE"}
        onClose={() => setShowPxpipeModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className={styles.description}>
            Compress prompts using multimodal encoding. Runs in-process — no extra server or
            environment variables required.
          </p>
          <div className={styles.statusRow}>
            <span>Status</span>
            <StatusBadge variant={pxpipeHealthy || pxpipeStatus.running ? "success" : "warning"}>
              {pxpipeStatusLabel}
              {pxpipeStatus.version ? ` · v${pxpipeStatus.version}` : ""}
            </StatusBadge>
          </div>
          {pxpipeHealth?.checks?.length > 0 && (
            <div className={styles.extras}>
              <p className={styles.fieldLabel}>Health check</p>
              <div className="flex flex-col gap-1">
                {pxpipeHealth.checks.map((check) => (
                  <div key={check.id} className={styles.statusRow}>
                    <StatusBadge variant={check.ok ? "success" : "warning"} dot={false}>
                      {check.label}
                    </StatusBadge>
                    {check.detail && (
                      <span className={`${styles.extrasMeta} truncate max-w-[50%]`}>{check.detail}</span>
                    )}
                  </div>
                ))}
              </div>
              {pxpipeHealth.error && <p className={styles.notice}>{pxpipeHealth.error}</p>}
            </div>
          )}
          {!pxpipeStatus.installed ? (
            <div className="flex flex-col gap-2">
              <p className={styles.notice}>PXPIPE is not installed.</p>
              <Button
                onClick={() => pxpipeAction("install")}
                variant="contrast"
                fullWidth
                disabled={pxpipeActionLoading || pxpipeStatus.installing}
              >
                {pxpipeActionLoading || pxpipeStatus.installing ? "Installing…" : "Install"}
              </Button>
              <p className={styles.description}>
                Installs the npm package <code className={styles.hintCode}>pxpipe-proxy</code> into
                the 9Router data directory. May take a few minutes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {pxpipeStatus.running ? (
                <>
                  <Button onClick={() => pxpipeAction("restart")} variant="ghost" disabled={pxpipeActionLoading}>
                    Restart
                  </Button>
                  <Button onClick={() => pxpipeAction("stop")} variant="ghost" disabled={pxpipeActionLoading}>
                    Stop
                  </Button>
                </>
              ) : (
                <Button onClick={() => pxpipeAction("start")} variant="contrast" disabled={pxpipeActionLoading}>
                  {pxpipeActionLoading ? "Starting…" : "Start"}
                </Button>
              )}
              <Button onClick={() => pxpipeAction("install")} variant="ghost" disabled={pxpipeActionLoading}>
                Repair
              </Button>
              <a href="/dashboard/pxpipe#logs" className={`${styles.linkButton} col-span-2`}>
                Open Logs
              </a>
            </div>
          )}
          <Input
            label="Minimum prompt size (chars)"
            value={String(pxpipeMinChars)}
            onChange={(e) => setPxpipeMinChars(e.target.value)}
            onBlur={handlePxpipeMinCharsBlur}
            placeholder="25000"
            hint="Requests smaller than this bypass PXPIPE and are sent as-is."
            inputClassName="font-mono text-xs"
          />
          {pxpipeActionError && <p className={styles.notice}>{pxpipeActionError}</p>}
          <div className="flex gap-2">
            <Button
              onClick={() => refreshPxpipeStatus().then(runPxpipeHealth)}
              variant="ghost"
              fullWidth
            >
              Recheck
            </Button>
            <Button onClick={() => setShowPxpipeModal(false)} variant="contrast" fullWidth>
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
