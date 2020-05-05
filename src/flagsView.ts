import * as vscode from 'vscode';
import { FeatureFlag } from './models';
import { LaunchDarklyAPI } from './api';
import { Configuration, getIsTreeviewEnabled } from './configuration';
import { FlagStore } from './flagStore';

export class ldFeatureFlagsProvider implements vscode.TreeDataProvider<FlagValue> {
  private readonly api: LaunchDarklyAPI;
  private config: Configuration;
  private flagStore: FlagStore;
  private flagValues: Array<FlagValue>;
  private ctx: vscode.ExtensionContext;
  private _onDidChangeTreeData: vscode.EventEmitter<FlagValue | undefined> = new vscode.EventEmitter<FlagValue | undefined>();
	readonly onDidChangeTreeData: vscode.Event<FlagValue | undefined> = this._onDidChangeTreeData.event;

  constructor(api: LaunchDarklyAPI, config: Configuration, flagStore: FlagStore, ctx: vscode.ExtensionContext) {
    this.api = api;
    this.config = config;
    this.ctx = ctx;
    this.flagStore = flagStore;
    this.start()
  }

	refresh(): void {
		this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FlagValue): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FlagValue): Thenable<FlagValue[]> {
    if (!this.flagValues) {
      return Promise.resolve([new FlagValue('No Flags Found.',vscode.TreeItemCollapsibleState.None)]);
    }

    if (element) {
      return Promise.resolve(element.children)
    } else {
      return Promise.resolve(this.flagValues.map(function(flag) {
        return flag
      }));
    }
  }

  async getFlags() {
    const flags = await this.api.getFeatureFlags(this.config.project)
    let flagValues = []
    for (const flag of flags) {
      let item = this.flagToValues(flag)
      flagValues.push(item)
    }
    this.flagValues = flagValues
    this.refresh()
  }

  async start() {

    this.ctx.subscriptions.push(
      vscode.commands.registerCommand('ldFeatureFlags.copyKey', (node: FlagValue) => vscode.env.clipboard.writeText(node.label.split(":")[1].trim())),
      vscode.commands.registerCommand('ldFeatureFlags.openBrowser', (node: FlagValue) => vscode.env.openExternal(vscode.Uri.parse(node.uri))),
      vscode.commands.registerCommand('ldFeatureFlags.toggleFlag', (node: FlagValue) => this.toggleFlag(node)),
      vscode.commands.registerCommand('ldFeatureFlags.refreshEntry', () => this.refresh()),
      registerTreeviewRefreshCommand(this)

    )

    var that = this;
    if (this.flagStore.ldClient === undefined) {
      setTimeout(function() {
      that.flagStore.ldClient.on('update', function (flags) {
        that.api.getFeatureFlagNew(that.config.project, flags.key, that.config.env).then((flag) => {
          for (let i = 0; i < that.flagValues.length; i++) {
            if (that.flagValues[i].label === flag.name) {
              that.flagValues[i] = that.flagToValues(flag)
              that.refresh()
              break
          }
        }
      })})
    }, 5000)}

    this.getFlags()
  }

  async toggleFlag(flag: FlagValue) {
    let curValue = JSON.parse(flag.label.split(":")[1].trim())
    try {
      var updatedFlag = await this.api.patchFeatureFlagOn(this.config.project, flag.flagKey, !curValue, this.config.env)
    } catch(e) {
      vscode.window.showInformationMessage("LaunchDarkly Toggle Flag Error: " + e);
    }
    for(let i = 0; i<this.flagValues.length; i++) {
      if (this.flagValues[i].label == flag.flagParentName) {
        this.flagValues[i] = this.flagToValues(updatedFlag)
        break
      }
    }
    this.refresh()
  }

  private flagToValues(flag: FeatureFlag): FlagValue {
    let flagUri = this.config.baseUri + flag.environments[this.config.env]._site.href
    let item = new FlagValue(flag.name, vscode.TreeItemCollapsibleState.Collapsed,
      [
        new FlagValue(`Open in Browser`, vscode.TreeItemCollapsibleState.None, [], "flagViewBrowser", flagUri),
        new FlagValue(`key: ${flag.key}`, vscode.TreeItemCollapsibleState.None, [], "flagViewKey"),
        new FlagValue(`on: ${flag.environments[this.config.env].on}`, vscode.TreeItemCollapsibleState.None, [], "flagViewToggle", "", flag.key, flag.name),
        new FlagValue(`description: ${flag.description ? flag.description : ""}`, vscode.TreeItemCollapsibleState.None),
        new FlagValue(`prerequisites: ${flag.environments[this.config.env].prerequisites}`, vscode.TreeItemCollapsibleState.None),
      ]
    )

    var targets: Array<FlagValue> = []
    if (flag.environments[this.config.env].targets) {
    for(let i = 0; i<flag.environments[this.config.env].targets.length; i++) {
        let curTarget = flag.environments[this.config.env].targets[i]
        targets.push(
          new FlagValue(`variation: ${flag.variations[curTarget.variation].name ? flag.variations[curTarget.variation].name : flag.variations[curTarget.variation].value}`, vscode.TreeItemCollapsibleState.None),
          new FlagValue(`values: ${curTarget.values}`, vscode.TreeItemCollapsibleState.None),
        )
      }
    }
    item.children.push(new FlagValue(`targets:`, targets.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, targets))

    var variations: Array<FlagValue> = []
    for(let i = 0; i<flag.variations.length; i++) {
      variations.push(
        new FlagValue(`name: ${flag.variations[i].name ? flag.variations[i].name : flag.variations[i].value}`, vscode.TreeItemCollapsibleState.None),
        new FlagValue(`value: ${flag.variations[i].value}`, vscode.TreeItemCollapsibleState.None),
        new FlagValue(`description: ${flag.variations[i].description ? flag.variations[i].description : ""}`, vscode.TreeItemCollapsibleState.None)
      )
    }
    item.children.push(new FlagValue(`variations:`, vscode.TreeItemCollapsibleState.Collapsed, variations))

    var rules: Array<FlagValue> = []
    let parseRules = flag.environments[this.config.env].rules
    if (parseRules) {
      for(let i = 0;i<parseRules.length;i++){
        let curRule = parseRules[i]
        var clauses: Array<FlagValue> = []
        if (curRule.clauses) {
          for (let j = 0; j<curRule.clauses.length;j++) {
            let clause = curRule.clauses[j]
            clauses.push(
              new FlagValue(`attribute: ${clause.attribute}`, vscode.TreeItemCollapsibleState.None),
              new FlagValue(`op: ${clause.op}`, vscode.TreeItemCollapsibleState.None),
              new FlagValue(`values: ${clause.values}`, vscode.TreeItemCollapsibleState.None),
              new FlagValue(`negate: ${clause.negate}`, vscode.TreeItemCollapsibleState.None),
              )
          }
        }
        rules.push(new FlagValue(`clauses:`, vscode.TreeItemCollapsibleState.Collapsed, clauses))
        if (flag.variations[curRule.variation]) {
          rules.push(new FlagValue(`variation: ${flag.variations[curRule.variation].name ? flag.variations[curRule.variation].name : flag.variations[curRule.variation].value}`, vscode.TreeItemCollapsibleState.None))
        } else {
          rules.push(new FlagValue(`variation: ${curRule.variation}`, vscode.TreeItemCollapsibleState.None))
        }
      }
    }
    item.children.push(new FlagValue(`rules:`, rules.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None , rules))

    if (flag.defaults !== undefined) {
      item.children.push(new FlagValue(`defaults:`, vscode.TreeItemCollapsibleState.Collapsed, [
        new FlagValue(`onVariation: ${flag.defaults.onVariation}`, vscode.TreeItemCollapsibleState.None),
        new FlagValue(`offVariation: ${flag.defaults.offVariation}`, vscode.TreeItemCollapsibleState.None),
        ])
      )
    }
    return item
  }
}


export class FlagValue extends vscode.TreeItem {
    children: FlagValue[]|undefined;
    contextValue?: string
    uri?: string
    flagKey?: string
    flagParentName?: string

    constructor(
      public readonly label: string,
      public readonly collapsibleState: vscode.TreeItemCollapsibleState,
      children?: FlagValue[],
      contextValue?: string,
      uri?: string,
      flagKey?: string,
      flagParentName?: string
    ) {
      super(label, collapsibleState);
      this.contextValue = contextValue
      this.children = children
      this.uri = uri
      this.flagKey = flagKey
      this.flagParentName = flagParentName
    }

    get tooltip(): string {
      return `${this.label}`
    }

}

export function registerTreeviewRefreshCommand(
	treeDataProvider: ldFeatureFlagsProvider
  ): vscode.Disposable {
	return vscode.commands.registerCommand(
	  'launchdarkly.treeviewrefresh',
	  (): void => {
		treeDataProvider.refresh();
		vscode.commands.executeCommand(
		  'setContext',
		  'launchdarkly:enableTreeview',
		  getIsTreeviewEnabled()
    );
	  }
	);
  }
