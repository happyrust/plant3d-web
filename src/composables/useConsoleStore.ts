import { ref } from 'vue';

export type LogType = 'input' | 'output' | 'error' | 'info';

export interface ConsoleLog {
    id: string;
    type: LogType;
    content: string;
    timestamp: number;
}

export type CommandHandler = (args: string[]) => void | Promise<void>;

const logs = ref<ConsoleLog[]>([]);
const history = ref<string[]>([]);
const historyIndex = ref<number>(-1);
const commands = new Map<string, CommandHandler>();

// Limit log size to prevent memory issues
const MAX_LOGS = 1000;
const MAX_HISTORY = 100;

// LocalStorage key for history persistence
const HISTORY_STORAGE_KEY = 'plant3d-console-history';

// Load history from localStorage on initialization
function loadHistoryFromStorage() {
    try {
        const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                history.value = parsed.slice(-MAX_HISTORY);
            }
        }
    } catch (e) {
        console.warn('Failed to load console history from localStorage:', e);
    }
}

// Save history to localStorage
function saveHistoryToStorage() {
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.value));
    } catch (e) {
        console.warn('Failed to save console history to localStorage:', e);
    }
}

// Initialize history from storage
loadHistoryFromStorage();

function addLog(type: LogType, content: string) {
    logs.value.push({
        id: Math.random().toString(36).substring(7),
        type,
        content,
        timestamp: Date.now(),
    });

    if (logs.value.length > MAX_LOGS) {
        logs.value.shift();
    }
}

function clearLogs() {
    logs.value = [];
}

function addToHistory(cmd: string) {
    if (history.value.length === 0 || history.value[history.value.length - 1] !== cmd) {
        history.value.push(cmd);
        if (history.value.length > MAX_HISTORY) {
            history.value.shift();
        }
        saveHistoryToStorage();
    }
    historyIndex.value = -1; // Reset index
}

function getHistoryPrevious(): string | null {
    if (history.value.length === 0) return null;
    if (historyIndex.value === -1) {
        historyIndex.value = history.value.length - 1;
    } else if (historyIndex.value > 0) {
        historyIndex.value--;
    }
    return history.value[historyIndex.value] ?? null;
}

function getHistoryNext(): string | null {
    if (history.value.length === 0 || historyIndex.value === -1) return null;
    if (historyIndex.value < history.value.length - 1) {
        historyIndex.value++;
        return history.value[historyIndex.value] ?? null;
    } else {
        historyIndex.value = -1;
        return ''; // Reset to empty if going past last history item
    }
}

function registerCommand(name: string, handler: CommandHandler) {
    commands.set(name.toLowerCase(), handler);
}

async function executeCommand(cmd: string) {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    addLog('input', `> ${trimmed}`);
    addToHistory(trimmed);

    // Special handling for commands starting with special characters
    // =123/456 -> command: =, arg: 123/456
    // /SITE-1 -> command: /, arg: SITE-1
    let commandName = '';
    let args: string[] = [];

    if (trimmed.startsWith('=')) {
        commandName = '=';
        const arg = trimmed.substring(1).trim();
        if (arg) args.push(arg);
    } else if (trimmed.startsWith('/')) {
        commandName = '/';
        const arg = trimmed.substring(1).trim();
        if (arg) args.push(arg);
	    } else {
	        const parts = trimmed.split(/\s+/); // Split by whitespace
	        commandName = (parts[0] ?? '').toLowerCase();
	        args = parts.slice(1);
	    }

    const handler = commands.get(commandName);

    if (handler) {
        try {
            await handler(args);
        } catch (e) {
            addLog('error', `Execution failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    } else {
        addLog('error', `Command not recognized: ${commandName}`);
    }
}

// Built-in commands
registerCommand('help', () => {
    addLog('info', 'Available commands:');
    addLog('info', '  help              - Show this help message');
    addLog('info', '  history           - Show recent command history');
    addLog('info', '  clear             - Clear console output');
    addLog('info', '  echo <text>       - Echo text to console');
    addLog('info', '');
    addLog('info', 'Query commands (Q):');
    addLog('info', '  q <attr>          - Query attribute of selected element');
    addLog('info', '  q wpos            - Query world position');
    addLog('info', '  q wori            - Query world orientation');
    addLog('info', '  q pos             - Query local position');
    addLog('info', '  q ori             - Query local orientation');
    addLog('info', '  q pos wrt owner   - Query position relative to owner');
    addLog('info', '  q ori wrt owner   - Query orientation relative to owner');
    addLog('info', '  q ref / q refno   - Query reference number');
    addLog('info', '  q dbnum           - Query database number');
    addLog('info', '');
    addLog('info', 'Navigation commands:');
    addLog('info', '  = <refno>         - Navigate to element by refno');
    addLog('info', '  / <name>          - Search and navigate by name');
});

registerCommand('clear', () => {
    clearLogs();
});

registerCommand('echo', (args) => {
    addLog('output', args.join(' '));
});

registerCommand('history', () => {
    const recent = history.value.slice(-10).reverse();
    if (recent.length === 0) {
        addLog('info', 'No command history');
        return;
    }
    addLog('info', 'Recent commands (last 10):');
    recent.forEach((cmd, i) => {
        if (cmd) {
            addLog('output', `  ${10 - i}. ${cmd}`);
        }
    });
});

export function useConsoleStore() {
    return {
        logs,
        addLog,
        clearLogs,
        executeCommand,
        getHistoryPrevious,
        getHistoryNext,
        registerCommand
    };
}
