import Icon from './Icon';

import logo1cPath from '../../images/btn__1c-logo.png';

interface Props {
  totalLabel: string;
  onPrint: () => void;
  onOpenImport: () => void;
}

// Шапка: заголовок «Реестр писем» слева; справа — источник, счётчик строк
// и кнопки действий «Импорт выгрузки из 1С» (официальный знак 1С) и «Печать».
function PageHeader({ totalLabel, onPrint, onOpenImport }: Props) {
  return (
    <div className="page-header">
      <div className="page-header__left">
        <div className="page-header__title">Реестр писем</div>
      </div>
      <div className="page-header__meta">
        <div className="page-header__note">Источник: выгрузка из 1С</div>
        <div className="page-header__divider" />
        <div className="page-header__note">{totalLabel}</div>
        <div className="page-header__divider" />
        <button type="button" className="btn btn_1c print-hide" onClick={onOpenImport}>
          <img className="btn__1c-logo" src={logo1cPath} alt="1С" />
          <span>Импорт выгрузки из 1С</span>
        </button>
        <button type="button" className="btn btn_secondary print-hide" onClick={onPrint}>
          <Icon name="print" size={20} className="btn__ico" />
          <span>Печать</span>
        </button>
      </div>
    </div>
  );
}

export default PageHeader;
