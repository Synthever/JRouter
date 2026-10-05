"use client";
import Icon from "@/shared/components/Icon";

import { Button } from "@/shared/components";
import StatusBadge from "@/shared/components/StatusBadge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  SKILLS,
  SKILLS_REPO_URL,
  getSkillRawUrl,
  getSkillBlobUrl,
} from "@/shared/constants/skills";
import styles from "./skills.module.css";

function CopyButton({ value, skillName, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={copied ? "check" : "content_copy"}
      onClick={() => copy(value)}
      title={value}
      aria-label={copied ? `Copied ${skillName} link` : `${label} for ${skillName}`}
    >
      {copied ? "Copied!" : label}
    </Button>
  );
}

function SkillRow({ skill }) {
  const url = getSkillRawUrl(skill.id);
  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.icon} data-entry={skill.isEntry ? "true" : "false"} aria-hidden="true">
          <Icon className="text-[18px]">{skill.icon}</Icon>
        </span>

        <div className="min-w-0">
          <div className={styles.titleLine}>
            <h3 className={styles.title}>{skill.name}</h3>
            {skill.isEntry && <StatusBadge dot={false}>Start here</StatusBadge>}
            {skill.endpoint && <code className={styles.endpoint}>{skill.endpoint}</code>}
          </div>
          <p className={styles.metadata}>{skill.description}</p>
          <a
            className={styles.url}
            href={getSkillBlobUrl(skill.id)}
            target="_blank"
            rel="noreferrer"
            title={url}
          >
            <span className={styles.urlText}>{url}</span>
            <Icon className="mt-[3px] shrink-0 text-[13px]">open_in_new</Icon>
          </a>
        </div>
      </div>

      <div className={styles.actions}>
        <CopyButton value={url} skillName={skill.name} />
      </div>
    </li>
  );
}

export default function SkillsPage() {
  return (
    <div className={`dashboard-surface ${styles.page}`}>
      <header className={styles.header}>
        <div className="min-w-0">
          <h1 className="ui-eyebrow flex items-center gap-2">
            <Icon className="text-[16px]">extension</Icon> Skills
          </h1>
          <p className={styles.description}>
            Reusable agent skills — copy a raw URL and paste it into any AI agent
          </p>
        </div>
      </header>

      <section className={`ui-card ${styles.section}`} aria-labelledby="skills-quickstart-heading">
        <div className={styles.sectionHeader}>
          <h2 id="skills-quickstart-heading" className="ui-eyebrow">Quick start</h2>
        </div>
        <p className={styles.hint}>Paste this to your AI:</p>
        <div className={styles.command}>
          <code>Read this skill and use it: {getSkillRawUrl("9router")}</code>
        </div>
      </section>

      <section className={`ui-card ${styles.section}`} aria-labelledby="skills-list-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="skills-list-heading" className="ui-eyebrow flex items-center gap-2">
              <Icon className="text-[16px]">list_alt</Icon> Available skills
            </h2>
            <p className={styles.sectionDescription}>
              {SKILLS.length} skills · each one is a single SKILL.md you can hand to an agent
            </p>
          </div>
        </div>
        <ul className={styles.rows}>
          {SKILLS.map((skill) => (
            <SkillRow key={skill.id} skill={skill} />
          ))}
        </ul>
      </section>

      <section className={`ui-card ${styles.section}`} aria-labelledby="skills-repo-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="skills-repo-heading" className="ui-eyebrow">More on GitHub</h2>
            <p className={styles.sectionDescription}>Browse source, README, and examples.</p>
          </div>
          <a
            className={styles.linkButton}
            href={`${SKILLS_REPO_URL}/tree/master/skills`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon className="text-[16px]">open_in_new</Icon>
            View on GitHub
          </a>
        </div>
      </section>
    </div>
  );
}
