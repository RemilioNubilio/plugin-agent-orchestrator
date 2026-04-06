declare module "pty-state-capture" {
  export class PTYStateCaptureManager {
    constructor(options?: {
      outputRootDir?: string;
      defaultRows?: number;
      defaultCols?: number;
    });
    openSession(
      sessionId: string,
      overrides?: {
        source?: string;
      },
    ): Promise<unknown>;
    feed(
      sessionId: string,
      chunk: string,
      direction?: "stdout" | "stderr" | "stdin",
    ): Promise<unknown>;
    lifecycle(
      sessionId: string,
      event: string,
      detail?: string,
    ): Promise<void>;
    snapshot(sessionId: string): unknown | null;
  }

  export function captureTerminalState(
    output: string,
    options?: {
      columns?: number;
      rows?: number;
    },
  ): {
    plainText: string;
    html?: string;
    ansi?: string;
  };
}
