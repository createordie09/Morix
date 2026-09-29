/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type WindowType = 'info' | 'liste_taches' | 'confirmation';

export interface WindowPosition {
  x: number;
  y: number;
}

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
}

export interface DashboardItem {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
}

export interface ConfirmationData {
  question: string;
  description?: string;
  resolved?: boolean;
  choice?: 'oui' | 'non';
}

export interface DashboardWindowData {
  id: string;
  type?: WindowType;
  title: string;
  position: WindowPosition;
  width?: number;
  items?: DashboardItem[];
  tasks?: TaskItem[];
  confirmation?: ConfirmationData;
}
