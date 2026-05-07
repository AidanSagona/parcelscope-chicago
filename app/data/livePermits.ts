export type LivePermit = {
  id: string;
  permitNumber: string;
  type: string;
  reviewType?: string;
  issueDate?: string;
  address: string;
  description?: string;
  reportedCost?: string;
  coordinates: [number, number];
  sourceUrl: string;
};
