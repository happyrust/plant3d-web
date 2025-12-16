type CommandHandler = (commandId: string) => void;

const handlers = new Set<CommandHandler>();

export function emitCommand(commandId: string) {
  for (const handler of handlers) {
    try {
      handler(commandId);
    } catch (err) {
      console.error(err);
    }
  }
}

export function onCommand(handler: CommandHandler) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
