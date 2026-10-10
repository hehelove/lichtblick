// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { t } from "i18next";
import * as THREE from "three";

import { fromNanoSec, toNanoSec, type Time } from "@lichtblick/rostime";
import { SettingsTreeAction, SettingsTreeFields } from "@lichtblick/suite";
import type { RosValue } from "@lichtblick/suite-base/players/types";

import type { AnyRendererSubscription, IRenderer } from "../IRenderer";
import { BaseUserData, Renderable } from "../Renderable";
import {
  PartialMessage,
  PartialMessageEvent,
  SceneExtension,
} from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";
import {
  makeRgba,
  rgbaGradient,
  rgbaToCssString,
  stringToRgba,
} from "../color";
import { LOCATION_FIX_DATATYPES } from "../foxglove";
import { normalizeHeader, normalizeTime } from "../normalizeMessages";
import {
  ColorRGBA,
  Header,
  Marker,
  MarkerAction,
  MarkerType,
  NavSatFix,
  NAV_SAT_FIX_DATATYPES,
} from "../ros";
import { BaseSettings, fieldGradient, fieldLineWidth } from "../settings";
import { topicIsConvertibleToSchema } from "../topicIsConvertibleToSchema";
import { makePose } from "../transforms";
import { RenderableLineStrip } from "./markers/RenderableLineStrip";

/** sensor_msgs/NavSatStatus: unable to fix position */
const STATUS_NO_FIX = -1;

/** WGS84 equatorial radius [m] */
const EARTH_RADIUS_EQUATORIAL = 6378137;

const DEFAULT_LINE_WIDTH = 0.2;
const DEFAULT_GRADIENT: [ColorRGBA, ColorRGBA] = [
  { r: 124 / 255, g: 107 / 255, b: 1, a: 1 },
  { r: 124 / 255, g: 107 / 255, b: 1, a: 0.5 },
];
const DEFAULT_GRADIENT_STR: [string, string] = [
  rgbaToCssString(DEFAULT_GRADIENT[0]),
  rgbaToCssString(DEFAULT_GRADIENT[1]),
];

export type LayerSettingsNavSatFix = BaseSettings & {
  lineWidth: number;
  gradient: [string, string];
  flattenAltitude: boolean;
};

const DEFAULT_SETTINGS: LayerSettingsNavSatFix = {
  visible: false,
  // Track vertices are already ENU meters in world coordinates; never re-transform through the
  // GPS antenna frame (see startFrame()).
  frameLocked: false,
  lineWidth: DEFAULT_LINE_WIDTH,
  gradient: DEFAULT_GRADIENT_STR,
  flattenAltitude: true,
};

// foxglove.LocationFix message shape (not available from @foxglove/schemas)
type FoxgloveLocationFix = {
  timestamp: Time;
  frame_id: string;
  latitude: number;
  longitude: number;
  altitude: number;
};

type GpsFix = {
  lat: number;
  lon: number;
  alt: number;
};

export type NavSatFixUserData = BaseUserData & {
  settings: LayerSettingsNavSatFix;
  topic: string;
  originalMessage: Record<string, RosValue>;
  fixes: GpsFix[];
  lineStrip?: RenderableLineStrip;
};

export class NavSatFixRenderable extends Renderable<NavSatFixUserData> {
  public override dispose(): void {
    this.userData.lineStrip?.dispose();
    super.dispose();
  }

  public override details(): Record<string, RosValue> {
    return this.userData.originalMessage;
  }
}

/**
 * Project geodetic coordinates (deg) to a local ENU tangent plane anchored at `origin`, in meters.
 * ponytail: 首个 fix 锚定的平面近似,>100km/极区漂移;出现海洋/全局数据再升 ECEF/UTM
 */
export function geodeticToENU(
  out: THREE.Vector3,
  lat: number,
  lon: number,
  alt: number,
  origin: { lat: number; lon: number },
): THREE.Vector3 {
  const lat0 = (origin.lat * Math.PI) / 180;
  out.set(
    (((lon - origin.lon) * Math.PI) / 180) *
      Math.cos(lat0) *
      EARTH_RADIUS_EQUATORIAL,
    (((lat - origin.lat) * Math.PI) / 180) * EARTH_RADIUS_EQUATORIAL,
    alt,
  );
  return out;
}

const tempVec = new THREE.Vector3();
const tempColor1 = makeRgba();
const tempColor2 = makeRgba();

const TIME_ZERO = { sec: 0, nsec: 0 };
const COLOR_WHITE = { r: 1, g: 1, b: 1, a: 1 };

export class NavSatFixes extends SceneExtension<NavSatFixRenderable> {
  public static extensionId = "foxglove.NavSatFixes";
  public constructor(
    renderer: IRenderer,
    name: string = NavSatFixes.extensionId,
  ) {
    super(name, renderer);
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    // No filterQueue on purpose: every fix accumulates into the track.
    // onlyLastByTopicMessage would collapse the track to a single point.
    return [
      {
        type: "schema",
        schemaNames: NAV_SAT_FIX_DATATYPES,
        subscription: { handler: this.#handleNavSatFix },
      },
      {
        type: "schema",
        schemaNames: LOCATION_FIX_DATATYPES,
        subscription: { handler: this.#handleNavSatFix },
      },
    ];
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const configTopics = this.renderer.config.topics;
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];
    for (const topic of this.renderer.topics ?? []) {
      if (!(
        topicIsConvertibleToSchema(topic, NAV_SAT_FIX_DATATYPES) ||
        topicIsConvertibleToSchema(topic, LOCATION_FIX_DATATYPES)
      )) {
        continue;
      }
      const config = (configTopics[topic.name] ??
        {}) as Partial<LayerSettingsNavSatFix>;
      const fields: SettingsTreeFields = {
        lineWidth: fieldLineWidth(
          t("threeDee:lineWidth"),
          config.lineWidth,
          DEFAULT_LINE_WIDTH,
        ),
        gradient: fieldGradient(
          t("threeDee:gradient"),
          config.gradient ?? DEFAULT_GRADIENT_STR,
        ),
        flattenAltitude: {
          label: t("threeDee:flattenAltitude"),
          input: "boolean",
          value: config.flattenAltitude ?? true,
        },
      };

      entries.push({
        path: ["topics", topic.name],
        node: {
          label: topic.name,
          icon: "Map",
          fields,
          visible: config.visible ?? DEFAULT_SETTINGS.visible,
          handler,
        },
      });
    }
    return entries;
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    this.saveSetting(path, action.payload.value);

    // Update the renderable
    const topicName = path[1]!;
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      const userSettings = (this.renderer.config.topics[topicName] ??
        {}) as Partial<LayerSettingsNavSatFix>;
      renderable.userData.settings = { ...DEFAULT_SETTINGS, ...userSettings };
      this.#updateTrack(renderable);
    }
  };

  public override startFrame(
    _currentTime: bigint,
    _renderFrameId: string,
    _fixedFrameId: string,
  ): void {
    // Track vertices are ENU meters relative to the first fix — already world coordinates — so we
    // do not call super.startFrame(): updatePose() would re-transform the whole track through the
    // GPS antenna frame (usually a dynamic TF to base_link), making the track swim with the robot.
    // userData.pose stays identity and frameLocked stays false as a guard for any base-class path.
    for (const renderable of this.renderables.values()) {
      renderable.visible = renderable.userData.settings.visible;
    }
  }

  #handleNavSatFix = (
    messageEvent: PartialMessageEvent<NavSatFix | FoxgloveLocationFix>,
  ): void => {
    const message = messageEvent.message;
    const isRos = "header" in message;
    const rosMessage = isRos ? message : undefined;
    const fgMessage = isRos
      ? undefined
      : (message as PartialMessage<FoxgloveLocationFix>);

    // Map panel hasFix() semantics: skip STATUS_NO_FIX (-1). foxglove.LocationFix carries no
    // status field, so undefined passes the gate.
    const status = rosMessage?.status?.status;
    if (status != undefined && status <= STATUS_NO_FIX) {
      return;
    }
    const latitude = message.latitude;
    const longitude = message.longitude;
    if (
      latitude == undefined ||
      longitude == undefined ||
      !isFinite(latitude) ||
      !isFinite(longitude)
    ) {
      return;
    }
    // NaN altitude only matters when flattening is off; treat it as 0
    const altitude =
      message.altitude != undefined && isFinite(message.altitude)
        ? message.altitude
        : 0;

    const header: Header = rosMessage
      ? normalizeHeader(rosMessage.header)
      : {
          frame_id: fgMessage!.frame_id ?? "",
          stamp: normalizeTime(fgMessage!.timestamp),
        };
    const receiveTime = toNanoSec(messageEvent.receiveTime);
    const topic = messageEvent.topic;

    let renderable = this.renderables.get(topic);
    if (!renderable) {
      // Set the initial settings from default values merged with any user settings
      const userSettings = (this.renderer.config.topics[topic] ??
        {}) as Partial<LayerSettingsNavSatFix>;
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };

      renderable = new NavSatFixRenderable(topic, this.renderer, {
        receiveTime,
        messageTime: toNanoSec(header.stamp),
        frameId: this.renderer.normalizeFrameId(header.frame_id),
        pose: makePose(),
        settingsPath: ["topics", topic],
        settings,
        topic,
        originalMessage: messageEvent.message,
        fixes: [],
      });

      this.add(renderable);
      this.renderables.set(topic, renderable);
    }

    renderable.userData.receiveTime = receiveTime;
    renderable.userData.messageTime = toNanoSec(header.stamp);
    renderable.userData.originalMessage = messageEvent.message;
    renderable.userData.fixes.push({
      lat: latitude,
      lon: longitude,
      alt: altitude,
    });

    this.#updateTrack(renderable);
  };

  #updateTrack(renderable: NavSatFixRenderable): void {
    const { fixes, settings, topic } = renderable.userData;
    if (fixes.length === 0) {
      return;
    }

    // Per-topic ENU origin anchored at the first valid fix
    const origin = { lat: fixes[0]!.lat, lon: fixes[0]!.lon };
    const points: THREE.Vector3[] = [];
    for (const fix of fixes) {
      geodeticToENU(tempVec, fix.lat, fix.lon, fix.alt, origin);
      points.push(
        new THREE.Vector3(
          tempVec.x,
          tempVec.y,
          settings.flattenAltitude ? 0 : tempVec.z,
        ),
      );
    }

    const colorStart = stringToRgba(tempColor1, settings.gradient[0]);
    const colorEnd = stringToRgba(tempColor2, settings.gradient[1]);
    const header: Header = {
      frame_id: renderable.userData.frameId,
      stamp: fromNanoSec(renderable.userData.messageTime),
    };
    const lineStripMarker = createLineStripMarker(
      header,
      points,
      settings.lineWidth,
      colorStart,
      colorEnd,
    );

    // Create a RenderableLineStrip if needed
    if (!renderable.userData.lineStrip) {
      const lineStrip = new RenderableLineStrip(
        topic,
        lineStripMarker,
        undefined,
        this.renderer,
      );
      renderable.userData.lineStrip = lineStrip;
      renderable.add(lineStrip);
    }

    renderable.userData.lineStrip.update(lineStripMarker, undefined);
  }
}

function createLineStripMarker(
  header: Header,
  points: THREE.Vector3[],
  lineWidth: number,
  colorStart: ColorRGBA,
  colorEnd: ColorRGBA,
): Marker {
  // Create a gradient of colors for the line strip
  const colors: ColorRGBA[] = [];
  for (let i = 0; i < points.length; i++) {
    const fraction = points.length > 1 ? i / (points.length - 1) : 0;
    colors.push(rgbaGradient(makeRgba(), colorStart, colorEnd, fraction));
  }

  return {
    header,
    ns: "",
    id: 0,
    type: MarkerType.LINE_STRIP,
    action: MarkerAction.ADD,
    pose: makePose(),
    scale: { x: lineWidth, y: 1, z: 1 },
    color: COLOR_WHITE,
    lifetime: TIME_ZERO,
    // ENU world coordinates — the track is not attached to a moving frame
    frame_locked: false,
    points,
    colors,
    text: "",
    mesh_resource: "",
    mesh_use_embedded_materials: false,
  };
}
