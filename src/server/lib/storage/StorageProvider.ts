export class StorageProvider {
  [key: string]: any;
  type?: string;
  config?: Record<string, any>;

  async getUploadUrl(_fileInfo: any, ..._rest: any[]): Promise<any> {
    throw new Error("getUploadUrl not implemented");
  }
  async getDownloadUrl(_fileKey: any, _options?: any): Promise<any> {
    throw new Error("getDownloadUrl not implemented");
  }
  async deleteFile(_fileKey: any, ..._rest: any[]): Promise<any> {
    throw new Error("deleteFile not implemented");
  }
  async exists(_fileKey: any, ..._rest: any[]): Promise<any> {
    throw new Error("exists not implemented");
  }
  async downloadToPath(_fileKey: any, _destPath: any, ..._rest: any[]): Promise<any> {
    throw new Error("downloadToPath not implemented");
  }
  async uploadFile(_fileKey: any, _filePath: any, _contentType?: any, ..._rest: any[]): Promise<any> {
    throw new Error("uploadFile not implemented");
  }
  async listObjects(_prefix: any = "", ..._rest: any[]): Promise<any> {
    throw new Error("listObjects not implemented");
  }
  async checkHealth(..._rest: any[]): Promise<any> {
    throw new Error("checkHealth not implemented");
  }
  async copyFile(_srcKey: any, _destKey: any, ..._rest: any[]): Promise<any> {
    throw new Error("copyFile not implemented");
  }
}
