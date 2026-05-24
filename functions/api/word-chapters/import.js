import { handleImportRequest } from "../../_docx_import_worker.js";

export const onRequest = ({ request }) => handleImportRequest(request);
