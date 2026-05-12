export enum IdDocumentType {
  CarteIdentite = 'CARTE_IDENTITE',
  Passeport = 'PASSEPORT',
  TitreSejour = 'TITRE_SEJOUR',
}

/**
 * Document types whose verso must also be photographed. Passport identity
 * page is one-sided; ID card and titre de séjour have a back.
 */
export const ID_DOCUMENT_TYPES_REQUIRING_VERSO: ReadonlySet<IdDocumentType> = new Set([
  IdDocumentType.CarteIdentite,
  IdDocumentType.TitreSejour,
]);
