/** Límite global de llamadas LLM concurrentes durante la evaluación (subdims + overviews). */

export const MAX_CONCURRENT_EVALUATE_LLM = 6;



/** Tope de concurrencia para la fase §6 de formateo (secciones + síntesis en paralelo). */

export const MAX_CONCURRENT_FORMAT_LLM = 10;



/** Tope compartido entre todos los requests de evaluación/formateo en el mismo proceso.
 *  Bajado a 5 tras logs mostrando saturación (active:8, queued:6) que produce empty_body en §6. */

export const GLOBAL_MAX_CONCURRENT_LLM = 5;



export class EvaluateLlmSemaphore {

  private active = 0;

  private readonly queue: Array<() => void> = [];



  constructor(private readonly max: number = MAX_CONCURRENT_EVALUATE_LLM) {}



  async acquire(): Promise<void> {

    if (this.active < this.max) {

      this.active++;

      return;

    }

    await new Promise<void>((resolve) => {

      this.queue.push(resolve);

    });

    this.active++;

  }



  release(): void {

    this.active--;

    const next = this.queue.shift();

    if (next) next();

  }



  async run<T>(fn: () => Promise<T>): Promise<T> {

    await this.acquire();

    try {

      return await fn();

    } finally {

      this.release();

    }

  }

}



let globalLlmSemaphore: EvaluateLlmSemaphore | null = null;



/** Semáforo singleton: limita LLM concurrentes entre proyectos bulk y fases evaluate/format. */

export function getGlobalLlmSemaphore(): EvaluateLlmSemaphore {

  if (!globalLlmSemaphore) {

    globalLlmSemaphore = new EvaluateLlmSemaphore(GLOBAL_MAX_CONCURRENT_LLM);

  }

  return globalLlmSemaphore;

}



/** @deprecated Usar getGlobalLlmSemaphore() para contención entre requests. */

export function createEvaluateLlmSemaphore(): EvaluateLlmSemaphore {

  return getGlobalLlmSemaphore();

}



/**

 * Semáforo de formateo §6: comparte el pool global del proceso.

 */

export function createFormatLlmSemaphore(_llmSectionCount: number): EvaluateLlmSemaphore {

  return getGlobalLlmSemaphore();

}


