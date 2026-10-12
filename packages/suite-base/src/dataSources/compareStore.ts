// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";

export const SLOT_LETTERS = ["A", "B", "C"] as const;

export type CompareSlotState = {
  slot: string;
  fileName: string;
  file: File;
  offsetNs: bigint;
};

type CompareStoreState = {
  active: boolean;
  playerId: string;
  slots: CompareSlotState[];

  /** Same File objects in the same order = rebuild (offsets survive); anything else = fresh session. */
  sessionFor: (files: File[]) => void;
  setOffset: (slot: string, offsetNs: bigint) => void;
  removeSlot: (slot: string) => void;
  addFiles: (files: File[]) => void;
  endSession: () => void;
};

export const useCompareStore = create<CompareStoreState>((set, get) => ({
  active: false,
  playerId: "",
  slots: [],

  sessionFor: (files) => {
    if (files.length === 0 || files.length > SLOT_LETTERS.length) {
      throw new Error(`Comparison supports 1-${SLOT_LETTERS.length} files`);
    }
    const current = get().slots;
    const isRebuild =
      current.length === files.length && current.every((slot, i) => slot.file === files[i]);
    if (isRebuild) {
      return;
    }
    set({
      active: true,
      // uuidv4 rather than crypto.randomUUID: jsdom (jest) has no stable crypto.randomUUID.
      playerId: get().playerId || uuidv4(),
      slots: files.map((file, i) => ({
        slot: SLOT_LETTERS[i]!,
        fileName: file.name,
        file,
        offsetNs: 0n,
      })),
    });
  },

  setOffset: (slot, offsetNs) => {
    set((state) => ({
      slots: state.slots.map((s) => (s.slot === slot ? { ...s, offsetNs } : s)),
    }));
  },

  removeSlot: (slot) => {
    set((state) => {
      if (state.slots.length <= 1) {
        return state; // 末槽不可删:无"关闭到无源"API
      }
      return {
        slots: state.slots
          .filter((s) => s.slot !== slot)
          .map((s, i) => ({ ...s, slot: SLOT_LETTERS[i]! })),
      };
    });
  },

  addFiles: (files) => {
    set((state) => {
      const room = SLOT_LETTERS.length - state.slots.length;
      if (room <= 0) {
        return state;
      }
      const slots = [...state.slots];
      for (const file of files.slice(0, room)) {
        slots.push({
          slot: SLOT_LETTERS[slots.length]!,
          fileName: file.name,
          file,
          offsetNs: 0n,
        });
      }
      return { slots };
    });
  },

  endSession: () => {
    set({ active: false, playerId: "", slots: [] });
  },
}));

/** True while the active player is a comparison session (store flag + player name agreement). */
export function useIsComparisonSession(): boolean {
  const active = useCompareStore((state) => state.active);
  const name = useMessagePipeline((ctx) => ctx.playerState.name);
  return active && (name?.startsWith("Comparison: ") ?? false);
}
