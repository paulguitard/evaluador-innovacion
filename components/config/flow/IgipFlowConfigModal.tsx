"use client";

import type { FlowConfigActionId } from "@/lib/eval-flow/igip-flow-definition";
import { getFlowActionLabel } from "@/lib/eval-flow/igip-flow-definition";
import type { EvaluationConfig } from "@/lib/evaluation-config";
import type { RubricConfig } from "@/lib/rubric-config";
import type { ReportFormatConfig } from "@/lib/report-format-config";
import type { ExtractConfig, RagConfig } from "@/lib/evaluation-type-settings";
import { ExtractConfigFields } from "@/components/config/TypeSettingsFields";
import { ExtractAdvancedConfigFields } from "@/components/config/ExtractAdvancedConfigFields";
import {
  EvaluationGeneralFields,
  EvaluationOrientationFields,
  EvaluationPromptsFields,
  EvaluationRagFields,
  EvaluationLimitsFields,
} from "@/components/config/EvaluationConfigFields";
import {
  EvaluationFormatPromptsFields,
  EvaluationReportTokensFields,
} from "@/components/config/evaluation/EvaluationFormatPromptsFields";
import { KnowledgeDocsSection, KnowledgeRagConfigSection } from "@/components/config/KnowledgeConfigSection";
import { ElementsListSection } from "@/components/config/ElementsListSection";
import RubricEditor from "@/components/rubric/RubricEditor";
import ReportFormatEditor from "@/components/report-format/ReportFormatEditor";
import { FlowConfigModal } from "./FlowConfigModal";

type KnowledgeItem = string | { name: string; url: string };

export function isWideFlowModal(actionId: FlowConfigActionId | null): boolean {
  return actionId === "report-structure" || actionId === "elements-list" || actionId === "rubric";
}

export function IgipFlowConfigModal({
  actionId,
  onClose,
  evaluationTypeName,
  config,
  onConfigChange,
  knowledgeDocsProps,
  elementsListProps,
}: {
  actionId: FlowConfigActionId | null;
  onClose: () => void;
  evaluationTypeName?: string;
  config: {
    elements: Parameters<typeof ElementsListSection>[0]["elements"];
    extract_config: ExtractConfig;
    knowledge_paths: KnowledgeItem[];
    rag_config: RagConfig;
    rubric_config: RubricConfig;
    evaluation_config: EvaluationConfig;
    report_format_config: ReportFormatConfig;
  };
  onConfigChange: {
    setExtract: (extract: ExtractConfig) => void;
    setRag: (rag: RagConfig) => void;
    setRubric: (rubric: RubricConfig) => void;
    setEvaluation: (evaluation: EvaluationConfig) => void;
    setReportFormat: (format: ReportFormatConfig) => void;
  };
  knowledgeDocsProps: Omit<Parameters<typeof KnowledgeDocsSection>[0], "knowledgePaths">;
  elementsListProps: Omit<Parameters<typeof ElementsListSection>[0], "elements">;
}) {
  if (!actionId) return null;

  const title = getFlowActionLabel(actionId);
  const wide = isWideFlowModal(actionId);

  const body = (() => {
    switch (actionId) {
      case "elements-list":
        return <ElementsListSection elements={config.elements} {...elementsListProps} />;
      case "extract-basic":
        return (
          <ExtractConfigFields
            embedded
            evaluationTypeName={evaluationTypeName}
            extract={config.extract_config}
            onChange={onConfigChange.setExtract}
          />
        );
      case "extract-advanced":
        return (
          <ExtractAdvancedConfigFields
            evaluationTypeName={evaluationTypeName}
            extract={config.extract_config}
            onChange={onConfigChange.setExtract}
          />
        );
      case "knowledge-docs":
        return (
          <KnowledgeDocsSection knowledgePaths={config.knowledge_paths} {...knowledgeDocsProps} />
        );
      case "rag-config":
        return <KnowledgeRagConfigSection rag={config.rag_config} onChange={onConfigChange.setRag} />;
      case "rubric":
        return <RubricEditor value={config.rubric_config} onChange={onConfigChange.setRubric} />;
      case "eval-general":
        return (
          <div className="text-xs">
            <EvaluationGeneralFields
              evaluation={config.evaluation_config}
              rubric={config.rubric_config}
              reportFormat={config.report_format_config}
              onChange={onConfigChange.setEvaluation}
              includeReportRatio={false}
            />
          </div>
        );
      case "eval-orientation":
        return (
          <div className="text-xs">
            <EvaluationOrientationFields
              evaluation={config.evaluation_config}
              rubric={config.rubric_config}
              reportFormat={config.report_format_config}
              onChange={onConfigChange.setEvaluation}
            />
          </div>
        );
      case "eval-prompts":
        return (
          <div className="text-xs">
            <EvaluationPromptsFields
              evaluation={config.evaluation_config}
              rubric={config.rubric_config}
              reportFormat={config.report_format_config}
              onChange={onConfigChange.setEvaluation}
            />
          </div>
        );
      case "eval-rag":
        return (
          <div className="text-xs">
            <EvaluationRagFields
              evaluation={config.evaluation_config}
              rubric={config.rubric_config}
              reportFormat={config.report_format_config}
              onChange={onConfigChange.setEvaluation}
            />
          </div>
        );
      case "eval-limits":
        return (
          <div className="text-xs">
            <EvaluationLimitsFields
              evaluation={config.evaluation_config}
              rubric={config.rubric_config}
              reportFormat={config.report_format_config}
              onChange={onConfigChange.setEvaluation}
              tokenKeys={["subdimension"]}
            />
          </div>
        );
      case "report-structure":
        return (
          <ReportFormatEditor
            value={config.report_format_config}
            rubric={config.rubric_config}
            onChange={onConfigChange.setReportFormat}
          />
        );
      case "report-prompts":
        return (
          <div className="text-xs">
            <EvaluationFormatPromptsFields
              evaluation={config.evaluation_config}
              rubric={config.rubric_config}
              reportFormat={config.report_format_config}
              onChange={onConfigChange.setEvaluation}
            />
          </div>
        );
      case "report-tokens":
        return (
          <div className="text-xs">
            <EvaluationReportTokensFields
              evaluation={config.evaluation_config}
              rubric={config.rubric_config}
              reportFormat={config.report_format_config}
              onChange={onConfigChange.setEvaluation}
            />
          </div>
        );
      default:
        return null;
    }
  })();

  return (
    <FlowConfigModal title={title} isOpen={!!actionId} onClose={onClose} wide={wide}>
      {body}
    </FlowConfigModal>
  );
}
