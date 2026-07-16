"use client";



import type { FlowConfigActionId } from "@/lib/eval-flow/igip-flow-definition";

import type { IgipPromptChainNode } from "@/lib/eval-flow/igip-prompt-chains-types";

import { FlowConfigModal } from "./FlowConfigModal";

import { EvaluateSystemAssemblyMap } from "./EvaluateSystemAssemblyMap";



export function FlowPromptDetailModal({

  node,

  isOpen,

  onClose,

  onOpenConfig,

}: {

  node: IgipPromptChainNode | null;

  isOpen: boolean;

  onClose: () => void;

  onOpenConfig?: (actionId: FlowConfigActionId) => void;

}) {

  if (!node) return null;



  const hasAssemblyMap = !!node.assemblyFlow;



  return (

    <FlowConfigModal

      title={hasAssemblyMap ? `Mensaje SYSTEM — mapa de ensamblado` : node.title}

      isOpen={isOpen}

      onClose={onClose}

      wide

    >

      <div className="space-y-4">

        <p className="text-xs text-gray-500 dark:text-gray-400">{node.description}</p>



        {hasAssemblyMap && node.assemblyFlow ? (

          <EvaluateSystemAssemblyMap flow={node.assemblyFlow} onOpenConfig={onOpenConfig} />

        ) : (

          <>

            {node.source === "dinámico" && (

              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">

                Este prompt no es un texto fijo editable: se ensambla en runtime.

              </p>

            )}

            <pre className="max-h-[min(60vh,28rem)] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-gray-800 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-200">

              {node.fullContent ?? node.content}

            </pre>

          </>

        )}

      </div>

    </FlowConfigModal>

  );

}


