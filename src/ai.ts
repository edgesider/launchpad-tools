import fs from 'node:fs';
import OpenAI from 'openai';
import { TinyRoot } from './tiny';

const systemPrompt = `
你是一个Mac图标的整理专家，以及JSON和TypeScript专家，你需要按照用户需要重新排列下面给出的Launchpad的TinyRoot，然后按照同样的数据结构输出。

\`\`\`typescript
// 表示单个App，值为App名称
// 可以是Page或者Folder的子级
type TinyApp = string;
// 表示一个文件夹，第一项为文件夹名，第二个参数是App列表
// 只能是Page的子级
type TinyFolder = [string, TinyApp[]];
// 表示一页，一页中的元素可能为App，也可能为文件夹，**只能是根节点的子级**
type TinyPage = (TinyFolder | TinyApp)[];
// 表示根节点，由多页构成
type TinyRoot = TinyPage[];
\`\`\`

## 注意

- 输出结果要**符合上述类型定义**，**Page只能在第2层、Folder只能在第3层、App只能在Page内或者Folder内**。
- 每个App的名称要和和输入完全一致，**大小写、空格等不会改变**。
- 所有App都只能来自当前的TinyRoot，其中**所有的App都要出现，且只能出现一次**。
- 输出需要是合法的JSON，输出JSON不需要格式化，压缩到一行以节省字符。
- 输出JSON结果即可，不需要额外的解释说明。
- 如果用户的输入未能指定明确的布局需求，请返回面向用户的提示文本，指导他使用方式

## 输出示例

平铺所有App到第一页：
[["App1","App2","App3"]]

所有App放到文件夹中
[[["文件夹1",["App1","App2","App3"]],["文件夹2",["App4","App5"]]]]

App1,App2,文件夹1放到第一页，App3,App4放到第二页
[["App1","App2",["文件夹1",[]]],["App3","App4"]]

App1,App2放到第一页的文件夹1中，App3,App4放到第一页直接
[[["文件夹1",["App1","App2"]], "App3","App4"]]

下面是当前的TinyRoot：
`.trim();

const client = new OpenAI({
  // baseURL: 'https://api.siliconflow.cn/v1',
  // apiKey: 'sk-ebwqjpdiufwxynydwrcgrkiaxceiurbmhplkagrgwjmvnvxc',
  baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-ace15b963f494a6fa4d7e4e0e72de225',
});

export async function getLayoutResult(root: TinyRoot, userPrompt: string): Promise<TinyRoot | null> {
  const input = JSON.stringify(root);
  fs.writeFileSync('llm_input.json', input);
  const response = await client.chat.completions.create({
    messages: [
      {
        role: 'system', content: systemPrompt
      },
      {
        role: 'system', content: input
      },
      {
        role: 'user', content: userPrompt
      },
    ],
    // model: 'Pro/deepseek-ai/DeepSeek-V3',
    // model: 'qwen-max-latest',
    model: 'deepseek-v3',
    temperature: 0.4,
    stream: true
  });

  let progress = 0;
  let result = '';
  for await (const resp of response) {
    const delta = resp.choices[0].delta.content;
    if (delta) {
      result += delta;
      progress = Math.min(result.length / input.length, 1);
      process.stdout.write(`\r${Math.round(progress * 100)}%`);
    }
  }
  process.stdout.write('\n');
  result = result.trim();
  if (result.startsWith('```')) {
    result = result.replace(/```(json)?/g, '').trim();
  }
  fs.writeFileSync('llm.json', result);
  try {
    return JSON.parse(result);
  } catch (e) {
    console.error('layout failed', e);
    return null;
  }
}
