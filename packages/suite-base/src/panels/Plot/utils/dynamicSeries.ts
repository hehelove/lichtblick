// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Immutable } from "@lichtblick/suite";
import { lineColors } from "@lichtblick/suite-base/util/plotColors";

import { getChartValue, isChartValue } from "./datum";
import { SeriesConfigKey, SeriesItem } from "../builders/IDatasetsBuilder";

export type DynamicSeriesValue = {
  identity: string;
  label: string;
  sourceIndex: number;
  value: number;
};

type ResolveOptions = {
  configKey: string;
  labelField: string;
  valueField: string;
};

export function resolveDynamicSeries(
  input: unknown,
  options: ResolveOptions,
): DynamicSeriesValue[] {
  const values = Array.isArray(input) ? input : [];
  const byIdentity = new Map<string, DynamicSeriesValue>();
  for (let index = 0; index < values.length; index++) {
    const item = values[index];
    const labelValue = getField(item, options.labelField);
    if (!isDynamicLabel(labelValue)) {
      continue;
    }
    const rawValue = getField(item, options.valueField);
    if (!isChartValue(rawValue)) {
      continue;
    }
    const value = getChartValue(rawValue);
    if (value == undefined) {
      continue;
    }
    const identity = `${options.configKey}:${typeof labelValue}:${String(labelValue)}`;
    byIdentity.set(identity, {
      identity,
      label: String(labelValue),
      sourceIndex: index,
      value,
    });
  }
  return [...byIdentity.values()];
}

export class DynamicSeriesResolver {
  readonly #children = new Map<SeriesConfigKey, Map<string, Immutable<SeriesItem>>>();
  readonly #hidden = new Set<string>();
  #parents: Immutable<SeriesItem[]> = [];

  public setSeries(series: Immutable<SeriesItem[]>): void {
    this.#parents = series;
    const parentKeys = new Set(series.map((item) => item.key));
    for (const key of this.#children.keys()) {
      if (!parentKeys.has(key)) {
        this.#children.delete(key);
      }
    }
    for (const parent of series) {
      const children = this.#children.get(parent.key);
      if (!children) {
        continue;
      }
      for (const [identity, child] of children) {
        children.set(identity, {
          ...parent,
          key: child.key,
          compositeKey: child.compositeKey,
          configIndex: child.configIndex,
          dynamicParentConfigIndex: child.dynamicParentConfigIndex,
          color: parent.dynamicColorOverride === true ? parent.color : child.color,
          enabled: parent.enabled && !this.#hidden.has(identity),
          subLabel: child.subLabel,
        });
      }
    }
    this.#assignConfigIndices();
  }

  public resolve(config: Immutable<SeriesItem>, input: unknown): DynamicSeriesValue[] {
    const resolved = resolveDynamicSeries(input, {
      configKey: config.key,
      labelField: config.dynamicLabelField === "" ? "label" : (config.dynamicLabelField ?? "label"),
      valueField: config.dynamicValueField === "" ? "value" : (config.dynamicValueField ?? "value"),
    });
    if (resolved.length === 0 && !isDynamicSeries(config)) {
      return resolved;
    }
    let children = this.#children.get(config.key);
    if (!children) {
      children = new Map();
      this.#children.set(config.key, children);
    }
    for (const child of resolved) {
      if (children.has(child.identity)) {
        continue;
      }
      const color =
        config.dynamicColorOverride === true
          ? config.color
          : lineColors[hashLabel(child.identity) % lineColors.length]!;
      children.set(child.identity, {
        ...config,
        key: child.identity as SeriesConfigKey,
        compositeKey: child.identity,
        configIndex: config.configIndex,
        dynamicParentConfigIndex: config.configIndex,
        color,
        enabled: config.enabled && !this.#hidden.has(child.identity),
        subLabel: child.label,
      });
    }
    this.#assignConfigIndices();
    return resolved;
  }

  public getSeries(): Immutable<SeriesItem[]> {
    const result: Immutable<SeriesItem>[] = [];
    for (const parent of this.#parents) {
      const children = this.#children.get(parent.key);
      if (!isDynamicSeries(parent) && !children) {
        result.push(parent);
      } else if (children) {
        for (const child of children.values()) {
          result.push({
            ...child,
            enabled: parent.enabled && !this.#hidden.has(child.compositeKey!),
          });
        }
      }
    }
    return result;
  }

  public getChildren(parentKey: SeriesConfigKey): Immutable<SeriesItem[]> {
    return [...(this.#children.get(parentKey)?.values() ?? [])];
  }

  public setEnabled(identity: string, options: { enabled: boolean }): void {
    if (options.enabled) {
      this.#hidden.delete(identity);
    } else {
      this.#hidden.add(identity);
    }
  }

  #assignConfigIndices(): void {
    let nextDynamicIndex = Math.max(0, ...this.#parents.map((item) => item.configIndex + 1));
    for (const parent of this.#parents) {
      const children = this.#children.get(parent.key);
      if (!children) {
        continue;
      }
      let childIndex = 0;
      for (const [identity, child] of children) {
        children.set(identity, {
          ...child,
          configIndex: childIndex++ === 0 ? parent.configIndex : nextDynamicIndex++,
          dynamicParentConfigIndex: parent.configIndex,
        });
      }
    }
  }
}

export function isDynamicSeries(config: Immutable<SeriesItem>): boolean {
  return Boolean(config.dynamicLabelField) || Boolean(config.dynamicValueField);
}

function getField(value: unknown, field: string): unknown {
  let current = value;
  for (const part of field.split(".")) {
    if (typeof current !== "object" || current == undefined || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isDynamicLabel(value: unknown): value is string | number | boolean | bigint {
  return ["string", "number", "boolean", "bigint"].includes(typeof value);
}

function hashLabel(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
