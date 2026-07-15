import readline from 'node:readline';

/**
 * Tiny prompt helper over injectable streams (tests feed a script through a
 * PassThrough). Lines are buffered from the moment the prompter is created,
 * so scripted input is never lost between questions. `hidden: true`
 * suppresses echo for secret input: on a real terminal readline runs in raw
 * mode and we drop its echo writes; on piped input nothing echoes anyway.
 */
export interface AskOptions {
  hidden?: boolean;
  defaultValue?: string;
}

export interface Prompter {
  ask(question: string, options?: AskOptions): Promise<string>;
  close(): void;
}

interface EchoControllable {
  _writeToOutput?: (chunk: string) => void;
}

export function createPrompter(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Prompter {
  const isTty = (input as NodeJS.ReadStream).isTTY === true;
  const rl = readline.createInterface({
    input,
    output: isTty ? output : undefined,
    terminal: isTty,
  });

  // Buffer every line as it arrives; ask() consumes from the buffer.
  const buffered: string[] = [];
  let waiter: ((line: string) => void) | undefined;
  let ended = false;
  rl.on('line', (line) => {
    if (waiter !== undefined) {
      const resolve = waiter;
      waiter = undefined;
      resolve(line);
    } else {
      buffered.push(line);
    }
  });
  rl.on('close', () => {
    ended = true;
    if (waiter !== undefined) {
      const resolve = waiter;
      waiter = undefined;
      resolve('');
    }
  });

  const nextLine = (): Promise<string> => {
    const line = buffered.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (ended) return Promise.resolve('');
    return new Promise((resolve) => {
      waiter = resolve;
    });
  };

  let closed = false;
  return {
    async ask(question: string, options?: AskOptions): Promise<string> {
      if (closed) throw new Error('prompter is closed');
      const suffix =
        options?.defaultValue !== undefined && options.defaultValue !== ''
          ? ` [${options.defaultValue}]`
          : '';
      const hint = options?.hidden === true ? ' (input hidden)' : '';
      output.write(`${question}${suffix}${hint}: `);

      const echoControl = rl as unknown as EchoControllable;
      const originalWrite = echoControl._writeToOutput;
      if (options?.hidden === true && isTty) {
        // Raw-mode readline echoes through _writeToOutput; swallow everything
        // except the final newline so the secret never lands on screen.
        echoControl._writeToOutput = (chunk: string) => {
          if (chunk.includes('\n') || chunk.includes('\r')) {
            output.write('\n');
          }
        };
      }
      try {
        const answer = await nextLine();
        if (options?.hidden === true && !isTty) {
          // Piped input never echoed; keep the visual rhythm consistent.
          output.write('\n');
        }
        const trimmed = answer.trim();
        return trimmed === '' ? (options?.defaultValue ?? '') : trimmed;
      } finally {
        if (options?.hidden === true && isTty) {
          if (originalWrite === undefined) {
            delete echoControl._writeToOutput;
          } else {
            echoControl._writeToOutput = originalWrite;
          }
        }
      }
    },
    close(): void {
      closed = true;
      rl.close();
    },
  };
}
