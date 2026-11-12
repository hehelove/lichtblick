import { eulerToQuaternion, quaternionToEuler } from "./quaternions";

describe("quaternions", () => {
  it("converts quaternions to euler angles", () => {
    const quaternion = {
      x: 0.03813457647485015,
      y: 0.189307857412,
      z: 0.2392983377447303,
      w: 0.9515485246437886,
    };

    const euler = quaternionToEuler(quaternion);
    expect(euler.roll).toBeCloseTo(10);
    expect(euler.pitch).toBeCloseTo(20);
    expect(euler.yaw).toBeCloseTo(30);
  });

  it("round-trips eulerToQuaternion through quaternionToEuler", () => {
    const quaternion = eulerToQuaternion({ x: 0.1, y: 0.2, z: 0.3 });

    const euler = quaternionToEuler(quaternion);
    const radToDeg = 180 / Math.PI;
    expect(euler.roll).toBeCloseTo(0.1 * radToDeg);
    expect(euler.pitch).toBeCloseTo(0.2 * radToDeg);
    expect(euler.yaw).toBeCloseTo(0.3 * radToDeg);
  });
});
