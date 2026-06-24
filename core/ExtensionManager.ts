import { eventBus } from './EventBus';

export interface ExtensionManifest {
    id: string;
    version: string;
    name: string;
    author?: string;
    description?: string;
}

export interface ExtensionContext {
    onMount: () => void;
    onUnmount: () => void;
}

export interface Extension {
    manifest: ExtensionManifest;
    activate: (context: ExtensionContext) => void;
    deactivate: () => void;
}

class SystemExtensionManager {
    private activeExtensions: Map<string, Extension> = new Map();

    registerExtension(extension: Extension) {
        if (this.activeExtensions.has(extension.manifest.id)) {
            console.warn(`[ExtensionManager] Extension ${extension.manifest.id} is already registered.`);
            return;
        }

        try {
            const context: ExtensionContext = {
                onMount: () => eventBus.emit(`extension:${extension.manifest.id}:mounted`),
                onUnmount: () => eventBus.emit(`extension:${extension.manifest.id}:unmounted`)
            };
            
            extension.activate(context);
            this.activeExtensions.set(extension.manifest.id, extension);
            console.log(`[ExtensionManager] Successfully activated extension: ${extension.manifest.name}`);
        } catch (err) {
            console.error(`[ExtensionManager] Failed to activate extension ${extension.manifest.id}:`, err);
        }
    }

    removeExtension(id: string) {
        const ext = this.activeExtensions.get(id);
        if (ext) {
            try {
                ext.deactivate();
                this.activeExtensions.delete(id);
                console.log(`[ExtensionManager] Successfully deactivated extension: ${id}`);
            } catch (err) {
                console.error(`[ExtensionManager] Failed to deactivate extension ${id}:`, err);
            }
        }
    }

    getAllActiveExtensions() {
        return Array.from(this.activeExtensions.values());
    }
}

export const extensionManager = new SystemExtensionManager();
