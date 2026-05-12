export enum DriverVehicleType {
  Bicycle = 'BICYCLE',
  Scooter = 'SCOOTER',
  Car = 'CAR',
}

/** SCOOTER and CAR require driving license + carte grise + insurance for KYC. */
export const MOTORIZED_VEHICLES: ReadonlySet<DriverVehicleType> = new Set([
  DriverVehicleType.Scooter,
  DriverVehicleType.Car,
]);
