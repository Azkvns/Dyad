import type { ReportListItem } from "contracts";
import { Link } from "react-router-dom";
import { formatWhen, reasonText } from "../format";

export function ReportsPage({ reports }: { reports: ReportListItem[] }) {
  return (
    <main className="subpage">
      <header className="sub-head">
        <h1>Жалобы</h1>
        <Link to="/dialogs">К диалогам</Link>
      </header>
      <ul className="report-list">
        {reports.map((report) => (
          <li key={report.id}>
            <strong>{report.peerUsername}</strong>
            <p>{report.body}</p>
            <p className="quiet">{reasonText(report.reason)}</p>
            <p className="quiet">{formatWhen(report.createdAt, new Date())}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
