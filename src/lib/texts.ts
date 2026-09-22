// Тексты со склонением (QA-3 п.6, п.9): единица программы — «письмо», группа — «тема».
// Отдельный файл, а не dates.ts: изоляция от правок оси таймлайна (F5) и тестируемость.
import { plural } from './dates';

/** «1 письмо / 2 письма / 5 писем». */
export function lettersLabel(n: number): string {
  return `${n} ${plural(n, 'письмо', 'письма', 'писем')}`;
}

/** «1 тема / 3 темы / 5 тем» — строго, с исключением 11–14. */
export function themesLabel(n: number): string {
  return `${n} ${plural(n, 'тема', 'темы', 'тем')}`;
}

/** Тултип числа у темы в окне тем: «39 писем в теме». */
export function lettersInThemeTitle(n: number): string {
  return `${lettersLabel(n)} в теме`;
}

export interface DeleteThemeConfirmText {
  question: string;
  detail: string;
}

/** Подтверждение удаления темы (п.9): вопрос + что станет с письмами (глагол согласован с числом). */
export function deleteThemeConfirm(name: string, count: number): DeleteThemeConfirmText {
  const question = `Удалить тему «${name}»?`;
  if (count === 0) return { question, detail: 'В теме нет писем' };
  const verb = plural(count, 'перейдёт', 'перейдут', 'перейдут');
  return { question, detail: `${lettersLabel(count)} ${verb} в «Без темы»` };
}
