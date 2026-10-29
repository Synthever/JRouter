"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Button from "@/shared/components/Button";
import Icon from "@/shared/components/Icon";
import Input from "@/shared/components/Input";
import ModelHealthStatusBadge from "./ModelHealthStatusBadge";
import { latency, percent, relativeTime, statusLabel } from "./format";
import styles from "../health.module.css";

export default function ModelsHealthTable({ models, testing, busyAll, onTest, onSelect }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const providers = useMemo(() => [...new Map(models.map((model) => [model.providerId, model.providerName])).entries()], [models]);
  const filtered = models.filter((model) => (!status || model.status === status) && (!provider || model.providerId === provider) && `${model.name} ${model.modelId}`.toLowerCase().includes(search.toLowerCase()));
  return <section className={styles.panel} aria-labelledby="models-health-title">
    <div className={styles.panelHead}>
      <div className={styles.panelHeadCopy}>
        <h2 className={styles.panelTitle} id="models-health-title"><Icon className={styles.panelIcon} size={18}>smart_toy</Icon>Models health</h2>
        <p className={styles.panelDesc}>{models.length} configured models · {models.filter((model) => model.status === "UNKNOWN").length} unknown</p>
      </div>
      <div className={styles.panelActions}>
        <div className={styles.filters}>
          <Input placeholder="Search model..." aria-label="Search model" value={search} onChange={(event) => setSearch(event.target.value)} icon="search" className={styles.search} />
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} className={styles.select}><option value="">All statuses</option>{["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
          <select aria-label="Filter by provider" value={provider} onChange={(event) => setProvider(event.target.value)} className={styles.select}><option value="">All providers</option>{providers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </div>
      </div>
    </div>
    {!models.length ? <div className={styles.empty}><h3>No models available</h3><p>Add models or configure providers before running health checks.</p><Link href="/dashboard/providers" className={styles.link}>Configure providers</Link></div> : !filtered.length ? <div className={styles.empty}><h3>No matching models</h3><p>Try another search or change the filters.</p><Button variant="secondary" size="sm" className={styles.ctaSm} onClick={() => { setSearch(""); setStatus(""); setProvider(""); }}>Clear filters</Button></div> : <div className={styles.tableScroll}>
      <table className={styles.table}><thead><tr>{["Model", "Provider", "Status", "Latency", "24H Availability", "Last Check", "Action"].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{filtered.map((model) => <tr key={model.id} onClick={() => onSelect(model)} className={styles.modelRow}>
          <td><button type="button" className={styles.modelName} onClick={(event) => { event.stopPropagation(); onSelect(model); }}>{model.name}</button><div className={styles.modelId} title={model.modelId}>{model.modelId}</div></td>
          <td>{model.providerName}</td><td><ModelHealthStatusBadge status={model.status} /></td><td className="u-tnum">{latency(model.latencyMs)}</td><td className="u-tnum">{percent(model.availability)}</td><td title={model.lastCheckAt ? new Date(model.lastCheckAt).toLocaleString() : "No completed checks"}>{relativeTime(model.lastCheckAt)}</td>
          <td><Button variant="outline" size="sm" className={styles.ctaSm} disabled={busyAll || testing.has(model.id)} loading={testing.has(model.id)} aria-label={`Test ${model.name}`} onClick={(event) => { event.stopPropagation(); onTest(model); }}>{testing.has(model.id) ? "Testing..." : "Test"}</Button></td>
        </tr>)}</tbody></table></div>}
  </section>;
}
