import { apiRequest } from './config';

export interface NewsHeadline {
  title: string;
  source: string;
  link: string;
  published?: string;
  ageMinutes?: number;
}

export interface NewsHeadlinesResponse {
  items: NewsHeadline[];
  updated_at: number;
  note?: string;
}

export async function fetchNewsHeadlines(): Promise<NewsHeadlinesResponse> {
  return await apiRequest<NewsHeadlinesResponse>('/news/headlines');
}
