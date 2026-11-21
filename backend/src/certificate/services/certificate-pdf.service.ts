import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface CertificatePdfData {
  certificateNo: string;
  candidateName: string;
  enrolmentId: string;
  courseName: string;
  centreName: string;
  issuedAt: Date;
}

export class CertificatePdfService {
  constructor(
    private readonly storageDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  filePathFor(certificateNo: string): string {
    return path.join(this.storageDir, `${certificateNo}.pdf`);
  }

  /**
   * Creates the PDF once. If the file already exists (job retried after a crash) it is reused.
   * Written to a temp file first and renamed, so a crash never leaves a half-written PDF.
   */
  async ensurePdf(data: CertificatePdfData): Promise<string> {
    const finalPath = this.filePathFor(data.certificateNo);
    if (existsSync(finalPath)) return finalPath;

    await mkdir(this.storageDir, { recursive: true });
    const tempPath = `${finalPath}.${process.pid}.tmp`;
    const verifyUrl = `${this.publicBaseUrl}/verify/${data.certificateNo}`;
    const qrPng = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 140 });

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
      const stream = createWriteStream(tempPath);
      stream.on('finish', resolve);
      stream.on('error', reject);
      doc.pipe(stream);

      const { width, height } = doc.page;
      doc.lineWidth(3).strokeColor('#1f4e79').rect(25, 25, width - 50, height - 50).stroke();

      doc.fillColor('#1f4e79').font('Helvetica-Bold').fontSize(16)
        .text('PRAGATI SKILLS MISSION', 0, 70, { align: 'center' });
      doc.fillColor('#222').font('Helvetica-Bold').fontSize(32)
        .text('Certificate of Skill Completion', 0, 110, { align: 'center' });
      doc.font('Helvetica').fontSize(14).text('This is to certify that', 0, 175, { align: 'center' });
      doc.font('Helvetica-Bold').fontSize(28).text(data.candidateName, 0, 205, { align: 'center' });
      doc.font('Helvetica').fontSize(14)
        .text(`Enrolment ID ${data.enrolmentId} has successfully completed`, 0, 255, { align: 'center' })
        .font('Helvetica-Bold').text(data.courseName, 0, 280, { align: 'center' })
        .font('Helvetica').text(`at ${data.centreName}`, 0, 305, { align: 'center' });

      doc.fontSize(11)
        .text(`Certificate No: ${data.certificateNo}`, 70, height - 150)
        .text(`Issued on: ${data.issuedAt.toISOString().slice(0, 10)}`, 70, height - 132)
        .text(`Verify at: ${verifyUrl}`, 70, height - 114);
      doc.image(qrPng, width - 200, height - 200, { width: 120 });
      doc.end();
    });

    await rename(tempPath, finalPath);
    return finalPath;
  }
}
