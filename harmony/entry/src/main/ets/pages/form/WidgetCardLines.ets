// ============================================================
// 变形虫桌面卡片 · lines 模板（对应 Android res/layout/widget_card.xml）
// 标题行(icon+title, 可隐藏) + 最多 6 条文本行 + footer
// 数据经 @LocalStorageProp 注入（FormBindingData.data 键，见 FormStore.buildBindingData）；
// 键名仅允许字母/数字/下划线。
// 点击整卡 postCardAction router 拉起 EntryAbility（tap 双通道见 EntryAbility/FormCommands）
// ============================================================
@Entry
@Component
struct WidgetCardLines {
  @LocalStorageProp('title') title: string = '变形虫'
  @LocalStorageProp('icon') icon: string = ''
  @LocalStorageProp('accent') accent: string = ''
  @LocalStorageProp('text_color') textColor: string = ''
  @LocalStorageProp('bg_color') bgColor: string = ''
  @LocalStorageProp('hide_title') hideTitle: boolean = false
  @LocalStorageProp('footer') footer: string = ''
  @LocalStorageProp('tap_path') tapPath: string = ''
  @LocalStorageProp('card_id') cardId: string = ''
  @LocalStorageProp('line0') line0: string = ''
  @LocalStorageProp('line1') line1: string = ''
  @LocalStorageProp('line2') line2: string = ''
  @LocalStorageProp('line3') line3: string = ''
  @LocalStorageProp('line4') line4: string = ''
  @LocalStorageProp('line5') line5: string = ''

  @Builder
  LineText(text: string) {
    Text(text)
      .fontSize(12)
      .fontColor(this.textColor.length > 0 ? this.textColor : '#DDDDDD')
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .width('100%')
      .margin({ top: 4 })
  }

  build() {
    Column() {
      if (!this.hideTitle) {
        Row() {
          if (this.icon.length > 0) {
            Text(this.icon)
              .fontSize(16)
              .margin({ right: 6 })
          }
          Text(this.title)
            .fontSize(15)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.accent.length > 0 ? this.accent : '#EEEEEE')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
      }

      if (this.line0.length > 0) {
        this.LineText(this.line0)
      }
      if (this.line1.length > 0) {
        this.LineText(this.line1)
      }
      if (this.line2.length > 0) {
        this.LineText(this.line2)
      }
      if (this.line3.length > 0) {
        this.LineText(this.line3)
      }
      if (this.line4.length > 0) {
        this.LineText(this.line4)
      }
      if (this.line5.length > 0) {
        this.LineText(this.line5)
      }

      if (this.footer.length > 0) {
        Text(this.footer)
          .fontSize(10)
          .fontColor('#88FFFFFF')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
          .margin({ top: 6 })
      }
    }
    .width('100%')
    .height('100%')
    .padding(12)
    // 缺省底色对齐 Android widget_bg drawable（#E61E1E22 圆角半透明深色）
    .backgroundColor(this.bgColor.length > 0 ? this.bgColor : '#E61E1E22')
    .borderRadius(16)
    .onClick(() => {
      postCardAction(this, {
        action: 'router',
        abilityName: 'EntryAbility',
        params: { tapPath: this.tapPath, cardId: this.cardId }
      })
    })
  }
}
