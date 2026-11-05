import {ast,nodesOf,maybeName,one,nameOf,edits} from './source.ts';
import type {AnyNode} from 'acorn';

const own=(node:AnyNode|undefined,property:string):boolean=>node?.type==='MemberExpression'&&node.object.type==='ThisExpression'&&maybeName(node.property)===property;

export function patchLiveRunAlias(source:string,checkpointSource=source):string {
  const tree=ast(source),checkpointTree=checkpointSource===source?tree:ast(checkpointSource);
  // The meta adapter passes account, ticket and a report against its original
  // snapshot. This identifies the live checkpoint without its minified name.
  const call=one(nodesOf(checkpointTree,'CallExpression',node=>node.callee.type==='MemberExpression'
    &&own(node.callee.object,'backend')&&node.arguments.length===3
    &&own(node.arguments[0],'account')&&own(node.arguments[1],'ticket')
    &&node.arguments[2]?.type==='CallExpression'&&own(node.arguments[2].callee,'report')
    &&own(node.arguments[2].arguments[2],'snap')),'live run backend call');
  const alias=nameOf(call.callee.type==='MemberExpression'?call.callee.property:undefined);
  const factory=one(nodesOf(tree,'FunctionDeclaration',node=>node.params.length===0&&node.body.body.length===1
    &&node.body.body[0]?.type==='ReturnStatement'&&node.body.body[0].argument?.type==='CallExpression'
    &&maybeName(node.body.body[0].argument.callee)==='createLocalSandboxBackend'),'local backend factory');
  return edits(source,[{start:factory.body.start+1,end:factory.body.end-1,
    text:`const backend=createLocalSandboxBackend();backend[${JSON.stringify(alias)}]=backend.keepLive.bind(backend);return backend;`}]);
}
