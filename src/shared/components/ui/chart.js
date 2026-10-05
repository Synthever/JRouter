"use client";

// Adapted from shadcn/ui's Base UI chart for this JavaScript project's theme tokens.
import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/shared/utils/cn";
import styles from "./chart.module.css";

const THEMES = { light: "", dark: ".dark" };
const INITIAL_DIMENSION = { width: 320, height: 200 };
const ChartContext = React.createContext(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

function ChartContainer({ id, className, children, config, initialDimension = INITIAL_DIMENSION, ...props }) {
  const uniqueId = React.useId();
  const chartId = `chart-${(id || uniqueId).replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div data-slot="chart" data-chart={chartId} className={cn(styles.chart, className)} {...props}>
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }) {
  const colors = Object.entries(config).filter(([, entry]) => entry.theme || entry.color);
  if (!colors.length) return null;

  return (
    <style>{Object.entries(THEMES).map(([theme, prefix]) => `${prefix} [data-chart="${id}"] {
${colors.map(([key, entry]) => {
  const color = entry.theme?.[theme] || entry.color;
  return color ? `  --color-${key}: ${color};` : "";
}).join("\n")}
}`).join("\n")}</style>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active, payload, className, indicator = "dot", hideLabel = false, hideIndicator = false,
  label, labelFormatter, labelClassName, formatter, color, nameKey, labelKey,
}) {
  const { config } = useChart();
  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey || item.dataKey || item.name || "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && typeof label === "string" ? (config[label]?.label || label) : itemConfig?.label;
    const content = labelFormatter ? labelFormatter(value, payload) : value;
    return content ? <div className={cn(styles.tooltipLabel, labelClassName)}>{content}</div> : null;
  }, [hideLabel, payload, labelKey, config, label, labelFormatter, labelClassName]);

  if (!active || !payload?.length) return null;
  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div data-slot="chart-tooltip" className={cn(styles.tooltip, className)}>
      {!nestLabel && tooltipLabel}
      {payload.filter((item) => item.type !== "none").map((item, index) => {
        const key = `${nameKey || item.name || item.dataKey || "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);
        const indicatorColor = color || item.payload?.fill || item.color;
        const ItemIcon = itemConfig?.icon;
        return (
          <div key={index} className={styles.tooltipRow}>
            {formatter && item.value !== undefined && item.name ? (
              formatter(item.value, item.name, item, index, item.payload)
            ) : (
              <>
                {ItemIcon ? <ItemIcon /> : !hideIndicator && (
                  <div
                    className={styles.indicator}
                    data-indicator={indicator}
                    style={{ "--indicator-color": indicatorColor }}
                    aria-hidden="true"
                  />
                )}
                <div className={styles.tooltipContent}>
                  <div>
                    {nestLabel && tooltipLabel}
                    <span className={styles.tooltipName}>{itemConfig?.label || item.name}</span>
                  </div>
                  {item.value != null && (
                    <span className={styles.tooltipValue}>
                      {typeof item.value === "number" ? item.value.toLocaleString() : String(item.value)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getPayloadConfigFromPayload(config, payload, key) {
  if (typeof payload !== "object" || payload === null) return undefined;
  const inner = typeof payload.payload === "object" && payload.payload !== null ? payload.payload : null;
  const configKey = typeof payload[key] === "string" ? payload[key] : typeof inner?.[key] === "string" ? inner[key] : key;
  return config[configKey] || config[key];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartStyle };