"use client";
import Icon from "@/shared/components/Icon";

import { Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  SKILLS,
  SKILLS_REPO_URL,
  getSkillRawUrl,
  getSkillBlobUrl,
} from "@/shared/constants/skills";
import styles from "./skills.module.css";

const ENTRY_SKILL_URL = getSkillRawUrl("jrouter");
const QUICK_START_COMMAND = `Read this skill and use it: ${ENTRY_SKILL_URL}`;

function CopyButton({ value, skillName, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <Button
      variant="outline"
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
          <Icon className="text-[20px]">{skill.icon}</Icon>
        </span>

        <div className={styles.body}>
          <div className={styles.titleLine}>
            <h3 className={styles.rowTitle}>{skill.name}</h3>
            {skill.isEntry && <span className={styles.badge}>Start here</span>}
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
            <Icon className="mt-[2px] shrink-0 text-[13px]">open_in_new</Icon>
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
      <header className={styles.intro}>
        <h1 className={styles.title}>Skills</h1>
        <p className={styles.sub}>
          Reusable agent skills — copy a raw URL and paste it into any AI agent
        </p>
      </header>

      <section className={styles.section} aria-labelledby="skills-quickstart-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="skills-quickstart-heading" className={styles.sectionTitle}>
              <Icon className={styles.sectionIcon}>bolt</Icon> Quick start
            </h2>
            <p className={styles.sectionDescription}>Paste this to your AI:</p>
          </div>
        </div>
        <div className={styles.quickStart}>
          <code className={styles.command}>{QUICK_START_COMMAND}</code>
          <CopyButton value={ENTRY_SKILL_URL} skillName="JRouter entry skill" label="Copy" />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="skills-list-heading">
        <div className={styles.sectionHeader}>
          <div className="min-w-0">
            <h2 id="skills-list-heading" className={styles.sectionTitle}>
              <Icon className={styles.sectionIcon}>list_alt</Icon> Available skills
              <small>{SKILLS.length} skills</small>
            </h2>
            <p className={styles.sectionDescription}>
              Each one is a single SKILL.md you can hand to an agent
            </p>
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
        <ul className={styles.rows}>
          {SKILLS.map((skill) => (
            <SkillRow key={skill.id} skill={skill} />
          ))}
        </ul>
      </section>
    </div>
  );
}
