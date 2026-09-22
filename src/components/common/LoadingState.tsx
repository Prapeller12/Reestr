
interface Props {
  text?: string;
}

function LoadingState({ text = 'Загрузка реестра…' }: Props) {
  return <div className="loading-state">{text}</div>;
}

export default LoadingState;
