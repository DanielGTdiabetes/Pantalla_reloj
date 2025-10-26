import { NewspaperIcon } from "../../icons";

type NewsItem = {
  title: string;
  summary?: string;
  source?: string;
};

type NewsCardProps = {
  items: NewsItem[];
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

export const NewsCard = ({ items }: NewsCardProps): JSX.Element => {
  const list = items.length > 0 ? items : [{ title: "Sin titulares disponibles" }];

  return (
    <div className="card news-card">
      <div className="news-card__header">
        <NewspaperIcon className="card-icon" aria-hidden="true" />
        <h2>Noticias del día</h2>
      </div>
      <div className="news-card__scroller">
        <div className="news-card__list">
          {repeatItems(list).map((item, index) => (
            <article key={`${item.title}-${index}`} className="news-card__item">
              <h3>{item.title}</h3>
              {item.summary ? <p>{item.summary}</p> : null}
              {item.source ? <span className="news-card__source">{item.source}</span> : null}
            </article>
          ))}
        </div>
      </div>
      <div className="news-card__gradient" aria-hidden="true" />
    </div>
  );
};

export default NewsCard;
