export interface RowError {
  row?: number;
  column?: string;
  field?: string;
  message: string;
}

/** Pop-up listing every problem in an uploaded spreadsheet. Nothing was saved when this shows. */
export function UploadErrorsDialog({ errors, onClose }: { errors: RowError[]; onClose: () => void }) {
  if (errors.length === 0) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>✖ The file has errors. Nothing was saved.</h2>
          <button className="toast-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="muted">
          {errors.length} problem(s). Fix these rows in your spreadsheet and upload it again (row numbers match Excel,
          header = row 1).
        </p>
        <div className="dialog-body">
          <table className="errors">
            <thead>
              <tr><th>Row</th><th>Column</th><th>Problem</th></tr>
            </thead>
            <tbody>
              {errors.map((error, index) => (
                <tr key={index}>
                  <td>{error.row ?? '—'}</td>
                  <td>{error.column ?? error.field}</td>
                  <td>{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dialog-footer">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
