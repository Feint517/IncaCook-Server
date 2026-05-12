export enum RatingCriterion {
  Hygiene = 'HYGIENE',
  FoodQuality = 'FOOD_QUALITY',
  Packaging = 'PACKAGING',
}

export enum RatingValueType {
  Percent = 'percent',
  Score5 = 'score5',
}

/**
 * Each criterion has a fixed value_type that the Flutter app uses to
 * render the input (slider for percent, stars for score5). The doc says
 * not to persist this — derive from the criterion enum.
 */
export const RATING_CRITERION_VALUE_TYPE: Readonly<Record<RatingCriterion, RatingValueType>> = {
  [RatingCriterion.Hygiene]: RatingValueType.Percent,
  [RatingCriterion.FoodQuality]: RatingValueType.Score5,
  [RatingCriterion.Packaging]: RatingValueType.Score5,
};
