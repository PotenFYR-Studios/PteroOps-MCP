import { MINECRAFT_PROFILES } from "./minecraft.js";
import {
  COMPOSE_WORKLOAD_PROFILE,
  CONTAINER_PROFILE,
  GAME_SERVER_PROFILE,
  GO_PROFILE,
  JAVA_APP_PROFILE,
  NODE_PROFILE,
  PHP_PROFILE,
  PYTHON_PROFILE,
  RUBY_PROFILE,
  RUST_PROFILE,
  UNKNOWN_PROFILE,
} from "./generic.js";
import type { ApplicationProfile } from "./types.js";

const ALL_PROFILES: ApplicationProfile[] = [
  ...MINECRAFT_PROFILES,
  NODE_PROFILE,
  PYTHON_PROFILE,
  JAVA_APP_PROFILE,
  GO_PROFILE,
  RUST_PROFILE,
  PHP_PROFILE,
  RUBY_PROFILE,
  GAME_SERVER_PROFILE,
  COMPOSE_WORKLOAD_PROFILE,
  CONTAINER_PROFILE,
];

export class ApplicationProfileRegistry {
  private readonly profiles: ApplicationProfile[];

  constructor(profiles: ApplicationProfile[] = ALL_PROFILES) {
    this.profiles = profiles;
  }

  lookup(application: string, distribution?: string): ApplicationProfile {
    if (application === "minecraft") {
      if (distribution) {
        const exact = this.profiles.find(
          (profile) => profile.application === "minecraft" && profile.distribution === distribution,
        );
        if (exact) return exact;
      }
      const generic = this.profiles.find(
        (profile) => profile.application === "minecraft" && !profile.distribution,
      );
      if (generic) return generic;
    }
    const byApplication = this.profiles.find((profile) => profile.application === application);
    if (byApplication) return byApplication;
    if (distribution === "dedicated-server") return GAME_SERVER_PROFILE;
    if (application === "unknown") return UNKNOWN_PROFILE;
    if (application === "container") return CONTAINER_PROFILE;
    return UNKNOWN_PROFILE;
  }

  byId(id: string): ApplicationProfile | null {
    return this.profiles.find((profile) => profile.id === id) ?? null;
  }

  list(): ApplicationProfile[] {
    return [...this.profiles];
  }
}

export function defaultProfileRegistry(): ApplicationProfileRegistry {
  return new ApplicationProfileRegistry();
}

export type { ApplicationProfile } from "./types.js";
