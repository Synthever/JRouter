import Icon from "@/shared/components/Icon";
import PropTypes from "prop-types";
import { CapacityBadges } from "@/shared/components";
import styles from "../providers.module.css";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix }) {
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
  const stateClass = testStatus === "ok"
    ? styles.modelChipOk
    : testStatus === "error"
    ? styles.modelChipError
    : "";
  const iconClass = testStatus === "ok"
    ? styles.chipIconOk
    : testStatus === "error"
    ? styles.chipIconError
    : "";
  const copiedNow = copied === `model-${model.id}`;

  return (
    <div className={`${styles.modelChip} ${stateClass}`}>
      <div className={styles.chipHead}>
        <Icon className={`${styles.chipIcon} ${iconClass}`} size={16}>
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </Icon>
        <div className={styles.chipBody}>
          <code className={styles.chipCode}>{displayModel}</code>
          <span className={styles.chipMeta}>
            {model.name && <span>{model.name}</span>}
            <CapacityBadges caps={caps} colorOverride="text-[var(--text-3)]" size={12} />
          </span>
        </div>
        <div className={styles.chipActions}>
          {onTest && (
            <button
              type="button"
              onClick={onTest}
              disabled={isTesting}
              className={styles.chipAction}
              aria-label={`Test ${model.id}`}
              title={isTesting ? "Testing…" : "Test model"}
            >
              <Icon size={15} style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </Icon>
            </button>
          )}
          <button
            type="button"
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
            className={styles.chipAction}
            aria-label={`Copy ${displayModel}`}
            title={copiedNow ? "Copied!" : "Copy model id"}
          >
            <Icon size={15}>{copiedNow ? "check" : "content_copy"}</Icon>
          </button>
          {isCustom ? (
            <button
              type="button"
              onClick={onDeleteAlias}
              className={`${styles.chipAction} ${styles.chipActionDanger}`}
              aria-label={`Remove ${model.id}`}
              title="Remove custom model"
            >
              <Icon size={15}>close</Icon>
            </button>
          ) : onDisable ? (
            <button
              type="button"
              onClick={onDisable}
              className={`${styles.chipAction} ${styles.chipActionDanger}`}
              aria-label={`Disable ${model.id}`}
              title="Disable this model"
            >
              <Icon size={15}>close</Icon>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
