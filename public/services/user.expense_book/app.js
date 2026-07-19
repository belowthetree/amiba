// 记账本 - Vue 3 + Chart.js 预置库示例
(function() {
  var STORAGE_KEY = 'expense_records';
  var CATEGORIES = ['餐饮', '交通', '购物', '娱乐', '居家', '医疗', '其他'];
  var CAT_ICONS = { '餐饮': '🍜', '交通': '🚌', '购物': '🛍️', '娱乐': '🎮', '居家': '🏠', '医疗': '💊', '其他': '📦' };
  var CHART_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF'];

  var createApp = window.Vue.createApp;

  createApp({
    data: function() {
      return {
        records: [],
        categories: CATEGORIES,
        form: { amount: null, category: CATEGORIES[0], note: '' }
      };
    },

    computed: {
      sortedRecords: function() {
        return this.records.slice().sort(function(a, b) { return b.at - a.at; });
      },
      monthTotal: function() {
        var now = new Date();
        return this.records
          .filter(function(r) {
            var d = new Date(r.at);
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
          })
          .reduce(function(sum, r) { return sum + r.amount; }, 0);
      }
    },

    watch: {
      records: {
        handler: function() {
          this.save();
          this.renderCharts();
        },
        deep: true
      }
    },

    mounted: async function() {
      var saved = await __amiba__.storage.get(STORAGE_KEY);
      if (Array.isArray(saved)) this.records = saved;
      this.renderCharts();
    },

    methods: {
      addRecord: function() {
        var amount = parseFloat(this.form.amount);
        if (!amount || amount <= 0) return;
        this.records.push({
          id: 'r' + Date.now(),
          amount: Math.round(amount * 100) / 100,
          category: this.form.category,
          note: this.form.note,
          at: Date.now()
        });
        this.form.amount = null;
        this.form.note = '';
      },

      removeRecord: function(id) {
        this.records = this.records.filter(function(r) { return r.id !== id; });
      },

      save: async function() {
        await __amiba__.storage.set(STORAGE_KEY, this.records);
      },

      categoryIcon: function(cat) {
        return CAT_ICONS[cat] || '📦';
      },

      formatDate: function(ts) {
        var d = new Date(ts);
        return (d.getMonth() + 1) + '/' + d.getDate();
      },

      // ---- 图表（数据变化时销毁重建，简单可靠）----

      renderCharts: function() {
        var self = this;
        this.$nextTick(function() {
          self._renderPie();
          self._renderBar();
        });
      },

      _renderPie: function() {
        var canvas = document.getElementById('chart-pie');
        if (!canvas || !window.Chart) return;

        var now = new Date();
        var sums = {};
        this.records.forEach(function(r) {
          var d = new Date(r.at);
          if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
            sums[r.category] = (sums[r.category] || 0) + r.amount;
          }
        });
        var labels = Object.keys(sums);
        if (!labels.length) return;

        if (this._pie) this._pie.destroy();
        this._pie = new Chart(canvas, {
          type: 'pie',
          data: {
            labels: labels,
            datasets: [{
              data: labels.map(function(k) { return sums[k]; }),
              backgroundColor: CHART_COLORS
            }]
          },
          options: {
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
          }
        });
      },

      _renderBar: function() {
        var canvas = document.getElementById('chart-bar');
        if (!canvas || !window.Chart) return;

        var now = new Date();
        var labels = [];
        var sums = [];
        for (var i = 5; i >= 0; i--) {
          var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          labels.push((d.getMonth() + 1) + '月');
          var total = this.records
            .filter(function(r) {
              var rd = new Date(r.at);
              return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth();
            })
            .reduce(function(s, r) { return s + r.amount; }, 0);
          sums.push(Math.round(total * 100) / 100);
        }

        if (this._bar) this._bar.destroy();
        this._bar = new Chart(canvas, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [{
              label: '支出',
              data: sums,
              backgroundColor: '#1976D2',
              borderRadius: 4
            }]
          },
          options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
          }
        });
      }
    }
  }).mount('#app');
})();
