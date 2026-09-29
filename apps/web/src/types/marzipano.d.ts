// Marzipano has no official TypeScript types and no @types package.
// This declares only the surface Panorama360Viewer.tsx actually uses.
declare module "marzipano" {
  export interface MarzipanoSource {
    __marzipanoSource?: never;
  }
  export interface MarzipanoGeometry {
    __marzipanoGeometry?: never;
  }
  export interface MarzipanoView {
    __marzipanoView?: never;
  }

  // The events consumers actually care about (textureLoad/textureError) are
  // only ever emitted here, on the TextureStore -- Layer merely listens to
  // them internally and re-emits an unrelated "textureStoreChange" event.
  export interface MarzipanoTextureStore {
    addEventListener(event: "textureLoad", handler: (tile: unknown) => void): void;
    addEventListener(event: "textureError", handler: (tile: unknown, err: unknown) => void): void;
    removeEventListener(event: "textureLoad", handler: (tile: unknown) => void): void;
    removeEventListener(event: "textureError", handler: (tile: unknown, err: unknown) => void): void;
  }

  export interface MarzipanoLayer {
    textureStore(): MarzipanoTextureStore;
  }

  export interface MarzipanoScene {
    layer(): MarzipanoLayer;
    switchTo(opts?: Record<string, unknown>): void;
  }

  export interface CreateSceneOptions {
    source: MarzipanoSource;
    geometry: MarzipanoGeometry;
    view: MarzipanoView;
    pinFirstLevel?: boolean;
  }

  export class Viewer {
    constructor(domElement: HTMLElement, opts?: Record<string, unknown>);
    createScene(opts: CreateSceneOptions): MarzipanoScene;
    destroy(): void;
  }

  export const ImageUrlSource: {
    fromString(url: string): MarzipanoSource;
  };

  export class EquirectGeometry implements MarzipanoGeometry {
    constructor(levels: Array<{ width: number }>);
  }

  export class RectilinearView implements MarzipanoView {
    constructor(params?: Record<string, unknown>, limiter?: unknown);
    static limit: {
      traditional(maxResolution: number, maxFovRad: number): unknown;
    };
  }
}
