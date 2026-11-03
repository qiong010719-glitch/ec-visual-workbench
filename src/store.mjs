import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, {recursive: true});
    this.file = path.join(directory, 'workbench.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {
      version: 1, tasks: {}, batches: {}, feedback: [], drafts: [], charges: [], balance: 100000
    };
    // Interrupted requests must not be automatically submitted and charged again.
    for (const task of Object.values(this.state.tasks)) {
      if (['pending', 'running'].includes(task.status)) {
        task.status = 'failed';
        task.phase = task.resultUrl ? 'download_failed' : 'generation_failed';
        task.error = task.resultUrl ? '服务重启，已保留生成结果，可只重试下载。' : '服务重启，任务结果未确认；请检查已有结果后手动重试。';
      }
    }
    this.save();
  }
  save() {
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2));
    fs.renameSync(temporary, this.file);
  }
  task(key, patch) {
    this.state.tasks[key] = {...this.state.tasks[key], ...patch, updatedAt: new Date().toISOString()};
    this.save();
    return this.state.tasks[key];
  }
}
